/**
 * Bridges the API layer with the @agnus-ai/reviewer package.
 * Assembles a ReviewContext (including graph context) and runs the PRReviewAgent.
 */
import crypto from 'crypto'
import path from 'path'
import { PRReviewAgent, GitHubAdapter, AzureDevOpsAdapter, createBackendFromEnv } from '@agnus-ai/reviewer'
import type { Config } from '@agnus-ai/reviewer'
import type { Pool } from 'pg'

// Skills bundled with the reviewer package
const SKILLS_PATH = path.join(require.resolve('@agnus-ai/reviewer'), '../../..', 'skills')
import { getRepo } from './graph-cache'
import { createEmbeddingAdapter } from './embedding-factory'
import type { GraphReviewContext } from '@agnus-ai/shared'

export interface ReviewRunOptions {
  platform: 'github' | 'azure'
  repoId: string
  repoUrl: string
  prNumber: number
  token?: string
  baseBranch: string
  pool: Pool
  /** Azure only: if true, diffs only the new commits since the previous push (webhook re-push mode) */
  incrementalDiff?: boolean
  /** GitHub only: if true, uses checkpoint-based incremental review (only new commits since last review) */
  incrementalReview?: boolean
  /** If true, skips posting comments and DB inserts — returns comments in the response for inspection */
  dryRun?: boolean
}

export async function runReview(opts: ReviewRunOptions): Promise<{ verdict: string; commentCount: number; reviewId: string; comments?: any[] }> {
  const { platform, repoId, repoUrl, prNumber, token, baseBranch, pool } = opts

  // Build VCS adapter
  let vcs
  if (platform === 'github') {
    if (!token) throw new Error('GitHub token required for review')
    // https://github.com/{owner}/{repo}
    const urlParts = repoUrl.replace(/\/$/, '').split('/')
    const owner = urlParts[urlParts.length - 2] ?? ''
    const repo = urlParts[urlParts.length - 1] ?? ''
    vcs = new GitHubAdapter({ token, owner, repo })
  } else {
    if (!token) throw new Error('Azure token required for review')
    // https://dev.azure.com/{org}/{project}/_git/{repo}
    const url = new URL(repoUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    // parts: ['org', 'project', '_git', 'repo']
    const organization = parts[0] ?? ''
    const project = parts[1] ?? ''
    const repository = parts[parts.length - 1] ?? ''
    const azureAdapter = new AzureDevOpsAdapter({ organization, project, repository, token })
    if (opts.incrementalDiff) azureAdapter.incrementalFromPreviousIteration = true
    vcs = azureAdapter
  }

  const config: Config = {
    vcs: {},
    tickets: [],
    llm: {
      provider: (process.env.LLM_PROVIDER as any) ?? 'ollama',
      model: process.env.LLM_MODEL ?? 'qwen3.5:397b-cloud',
      providers: {
        ollama: { baseURL: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1' },
      },
    },
    review: {
      maxDiffSize: process.env.MAX_DIFF_SIZE ? parseInt(process.env.MAX_DIFF_SIZE) : 150000,
      focusAreas: [],
      ignorePaths: ['node_modules', 'dist', 'build', '.git'],
      precisionThreshold: process.env.PRECISION_THRESHOLD ? parseFloat(process.env.PRECISION_THRESHOLD) : 0.7,
    },
    skills: {
      path: SKILLS_PATH,
      default: 'default',
    },
  }

  // Build LLM backend from provider-specific env vars
  const llm = createBackendFromEnv(process.env)

  const agent = new PRReviewAgent(config)
  agent.setVCS(vcs)
  agent.setLLM(llm)

  // Hoist diff to outer scope so it's available for RAG retrieval
  const diffString = await fetchDiffString(vcs, prNumber)

  // Assemble graph context from the base branch's graph (gracefully degraded if not indexed)
  let graphContext: GraphReviewContext | undefined
  const entry = getRepo(repoId, baseBranch)
  if (entry && diffString) {
    graphContext = await entry.retriever.getReviewContext(diffString, repoId)
  }

  // Retrieve prior accepted + rejected comments via embedding similarity (RAG)
  let priorExamples: string[] = []
  let rejectedExamples: string[] = []
  const embAdapter = createEmbeddingAdapter(pool)
  if (embAdapter && diffString) {
    try {
      const diffSample = diffString.substring(0, 8000)
      const [embedding] = await embAdapter.embed([diffSample])
      const vectorLiteral = `[${embedding.join(',')}]`

      const { rows: acceptedRows } = await pool.query(
        `SELECT rc.body, rc.path
         FROM review_comments rc
         JOIN review_feedback rf ON rf.comment_id = rc.id
         WHERE rc.repo_id = $1
           AND rf.signal = 'accepted'
           AND rc.embedding IS NOT NULL
         ORDER BY rc.embedding <-> $2
         LIMIT 5`,
        [repoId, vectorLiteral],
      )
      priorExamples = acceptedRows.map((r: any) => {
        const cleanBody = r.body.split('\n\n---\nWas this helpful?')[0].trim()
        return `[${r.path}]\n${cleanBody}`
      })

      const { rows: rejectedRows } = await pool.query(
        `SELECT rc.body, rc.path
         FROM review_comments rc
         JOIN review_feedback rf ON rf.comment_id = rc.id
         WHERE rc.repo_id = $1
           AND rf.signal = 'rejected'
           AND rc.embedding IS NOT NULL
         ORDER BY rc.embedding <-> $2
         LIMIT 3`,
        [repoId, vectorLiteral],
      )
      rejectedExamples = rejectedRows.map((r: any) => {
        const cleanBody = r.body.split('\n\n---\nWas this helpful?')[0].trim()
        return `[${r.path}]\n${cleanBody}`
      })
    } catch (err) {
      console.warn('[review-runner] RAG examples retrieval skipped:', (err as Error).message)
    }
  }

  // Attach examples to graphContext (or create a minimal ctx if graph wasn't available)
  if (priorExamples.length > 0 || rejectedExamples.length > 0) {
    if (graphContext) {
      if (priorExamples.length > 0) graphContext.priorExamples = priorExamples
      if (rejectedExamples.length > 0) graphContext.rejectedExamples = rejectedExamples
    } else {
      graphContext = {
        changedSymbols: [], callers: [], callees: [],
        blastRadius: { directCallers: [], transitiveCallers: [], affectedFiles: [], riskScore: 0 },
        semanticNeighbors: [],
        priorExamples: priorExamples.length > 0 ? priorExamples : undefined,
        rejectedExamples: rejectedExamples.length > 0 ? rejectedExamples : undefined,
      }
    }
  }

  const result = opts.incrementalReview && platform === 'github'
    ? await agent.incrementalReview(prNumber, {}, graphContext)
    : await agent.review(prNumber, graphContext)

  // Generate a stable reviewId upfront so review_comments can FK into reviews
  const reviewId = crypto.randomUUID()

  // Append 👍/👎 feedback links to each comment body (if BASE_URL is configured)
  const baseUrl = process.env.BASE_URL
  const feedbackSecret =
    process.env.FEEDBACK_SECRET ||
    process.env.WEBHOOK_SECRET ||
    process.env.SESSION_SECRET ||
    ''

  const commentRows: Array<{ id: string; path: string; line: number; body: string; severity: string; confidence: number | null }> = []

  const comments: any[] = Array.isArray((result as any).comments) ? (result as any).comments : []

  if (baseUrl && feedbackSecret) {
    for (const comment of comments) {
      const commentId = crypto.randomUUID()
      const tokenAccepted = crypto
        .createHmac('sha256', feedbackSecret)
        .update(`${commentId}:accepted`)
        .digest('hex')
      const tokenRejected = crypto
        .createHmac('sha256', feedbackSecret)
        .update(`${commentId}:rejected`)
        .digest('hex')

      const feedbackLine =
        `\n\n---\n` +
        `Was this helpful? ` +
        `[👍 Yes](${baseUrl}/api/feedback?id=${commentId}&signal=accepted&token=${tokenAccepted}) · ` +
        `[👎 No](${baseUrl}/api/feedback?id=${commentId}&signal=rejected&token=${tokenRejected})`

      comment.body = (comment.body ?? '').trim() + feedbackLine
      commentRows.push({
        id: commentId,
        path: comment.path ?? '',
        line: comment.line ?? 0,
        body: comment.body,
        severity: comment.severity ?? 'info',
        confidence: comment.confidence ?? null,
      })
    }
  }

  // Dry-run: skip DB writes and posting — return comments for inspection
  if (opts.dryRun) {
    return {
      verdict: (result as any).verdict ?? 'unknown',
      commentCount: comments.length,
      reviewId,
      comments: comments.map((c: any) => ({
        path: c.path,
        line: c.line,
        severity: c.severity,
        confidence: c.confidence,
        body: c.body,
      })),
    }
  }

  // Persist review row (moved here so both webhook and manual-review paths share one INSERT)
  await pool.query(
    `INSERT INTO reviews (id, repo_id, pr_number, verdict, comment_count) VALUES ($1,$2,$3,$4,$5)`,
    [reviewId, repoId, prNumber, (result as any).verdict ?? 'unknown', comments.length],
  )

  // Bulk-insert individual comment rows for feedback correlation
  if (commentRows.length > 0) {
    for (const row of commentRows) {
      await pool.query(
        `INSERT INTO review_comments (id, review_id, repo_id, pr_number, path, line, body, severity, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, reviewId, repoId, prNumber, row.path, row.line, row.body, row.severity, row.confidence],
      )
    }
  }

  // Embed comment bodies for future RAG retrieval
  if (embAdapter && commentRows.length > 0) {
    for (const row of commentRows) {
      try {
        const cleanBody = row.body.split('\n\n---\nWas this helpful?')[0].trim()
        const [emb] = await embAdapter.embed([cleanBody])
        await pool.query(
          `UPDATE review_comments SET embedding = $1 WHERE id = $2`,
          [`[${emb.join(',')}]`, row.id],
        )
      } catch (err) {
        console.warn('[review-runner] Comment embedding skipped:', (err as Error).message)
      }
    }
  }

  // Post to GitHub/Azure (comment bodies now include feedback links)
  await agent.postReview(prNumber, result)

  return {
    verdict: (result as any).verdict ?? 'unknown',
    commentCount: comments.length,
    reviewId,
  }
}

async function fetchDiffString(vcs: any, prNumber: number): Promise<string | null> {
  try {
    const diff = await vcs.getDiff(prNumber)
    return (diff.files as any[]).map((f: any) =>
      `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n` +
      (f.hunks as any[]).map((h: any) => h.content).join('\n')
    ).join('\n')
  } catch {
    return null
  }
}
