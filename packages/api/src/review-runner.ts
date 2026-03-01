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
import type { EnforcedRuleContext, GraphReviewContext } from '@agnus-ai/shared'
import {
  DEFAULT_REPO_PR_DESCRIPTION_SETTINGS,
  normalizeRepoPRDescriptionSettings,
  resolveRepoPRDescriptionSettings,
} from './repo-settings'
import { evaluateRuleSignals, isRuleApplicable, type RuleCandidate } from './rules-enforcement'

const AGENT_ROLES = [
  'security',
  'correctness',
  'performance',
  'style_maintainability',
  'ticket_compliance',
  'blast_radius',
] as const
type AgentRole = (typeof AGENT_ROLES)[number]

function parseEnabledAgents(raw: string | undefined): AgentRole[] | undefined {
  if (!raw?.trim()) return undefined
  const values = raw.split(',').map(v => v.trim()).filter(Boolean)
  const filtered = values.filter((v): v is AgentRole => (AGENT_ROLES as readonly string[]).includes(v))
  return filtered.length > 0 ? filtered : undefined
}

// Sequential per-PR lock — prevents concurrent webhooks posting duplicate comments
const prReviewLocks = new Map<string, Promise<void>>()

async function withPRLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const current = prReviewLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>(r => { release = r })
  prReviewLocks.set(key, next)
  try {
    await current
    return await fn()
  } finally {
    release()
    if (prReviewLocks.get(key) === next) prReviewLocks.delete(key)
  }
}

async function getLastReviewedIteration(pool: Pool, repoId: string, prNumber: number): Promise<number> {
  const res = await pool.query<{ last_reviewed_iteration: number }>(
    `SELECT last_reviewed_iteration FROM pr_review_state
     WHERE repo_id = $1 AND pr_number = $2 AND platform = 'azure'`,
    [repoId, prNumber],
  )
  return res.rows[0]?.last_reviewed_iteration ?? 0
}

async function saveLastReviewedIteration(pool: Pool, repoId: string, prNumber: number, iteration: number): Promise<void> {
  await pool.query(
    `INSERT INTO pr_review_state (repo_id, pr_number, platform, last_reviewed_iteration, updated_at)
     VALUES ($1, $2, 'azure', $3, NOW())
     ON CONFLICT (repo_id, pr_number, platform)
     DO UPDATE SET last_reviewed_iteration = $3, updated_at = NOW()`,
    [repoId, prNumber, iteration],
  )
}

export interface ReviewRunOptions {
  platform: 'github' | 'azure'
  repoId: string
  repoUrl: string
  prNumber: number
  token?: string
  baseBranch: string
  pool: Pool
  /** Azure only: if true, gates on iteration DB state and diffs only new commits since last reviewed iteration */
  incrementalDiff?: boolean
  /** GitHub only: if true, uses checkpoint-based incremental review (only new commits since last review) */
  incrementalReview?: boolean
  /** If true, skips posting comments and DB inserts — returns comments in the response for inspection */
  dryRun?: boolean
  /** If false, skip PR title/body/labels write-back while still posting review comments */
  updatePRDescription?: boolean
  /** PR event action to evaluate created-only vs updated behavior */
  prAction?: 'created' | 'updated' | 'opened' | 'synchronize' | 'manual'
}

type RuleRow = {
  id: string
  name: string
  content: string
  category: string
  severity: string
  scope_type: string
  repo_id: string | null
  path_pattern: string | null
}

async function resolveRepoOrgId(pool: Pool, repoId: string): Promise<string | null> {
  const res = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM repos WHERE repo_id = $1 LIMIT 1',
    [repoId],
  )
  return res.rows[0]?.org_id ?? null
}

function toRuleCandidate(row: RuleRow): RuleCandidate {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    category: row.category as any,
    severity: row.severity as any,
    scopeType: row.scope_type as any,
    repoId: row.repo_id,
    pathPattern: row.path_pattern,
  }
}

function toEnforcedRuleContext(rule: RuleCandidate): EnforcedRuleContext {
  return {
    id: rule.id,
    name: rule.name,
    content: rule.content,
    category: rule.category,
    severity: rule.severity,
    scopeType: rule.scopeType,
    repoId: rule.repoId,
    pathPattern: rule.pathPattern,
  }
}

async function resolveApplicableRules(
  pool: Pool,
  orgId: string,
  repoId: string,
  changedPaths: string[],
): Promise<RuleCandidate[]> {
  const res = await pool.query<RuleRow>(
    `SELECT id, name, content, category, severity, scope_type, repo_id, path_pattern
     FROM rules
     WHERE org_id = $1 AND enabled = true`,
    [orgId],
  )
  const candidates = res.rows.map(toRuleCandidate)
  return candidates.filter(rule => isRuleApplicable(rule, repoId, changedPaths))
}

export async function runReview(opts: ReviewRunOptions): Promise<{ verdict: string; commentCount: number; reviewId: string; comments?: any[] }> {
  const { platform, repoId, repoUrl, prNumber, token, pool } = opts

  // 1. Build VCS adapter
  let vcs: any
  let azureAdapter: AzureDevOpsAdapter | undefined
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
    azureAdapter = new AzureDevOpsAdapter({ organization, project, repository, token })
    vcs = azureAdapter
  }

  // 2. Azure incremental gate — skip non-commit events, diff only new commits since last review
  if (opts.incrementalDiff && azureAdapter) {
    const latestIteration = await azureAdapter.getLatestIterationId(prNumber)
    const lastReviewed = await getLastReviewedIteration(pool, repoId, prNumber)

    if (latestIteration <= lastReviewed) {
      console.log(`[review-runner] Azure PR ${prNumber}: iteration ${latestIteration} already reviewed — skipping`)
      return { verdict: 'comment', commentCount: 0, reviewId: '' }
    }

    return withPRLock(`${repoId}:${prNumber}`, async () => {
      // Re-check inside lock — a concurrent webhook may have just reviewed
      const lastReviewedNow = await getLastReviewedIteration(pool, repoId, prNumber)
      if (latestIteration <= lastReviewedNow) {
        console.log(`[review-runner] Azure PR ${prNumber}: already reviewed after lock — skipping`)
        return { verdict: 'comment', commentCount: 0, reviewId: '' }
      }
      azureAdapter!.compareToIteration = lastReviewedNow  // 0 = full diff on first review
      // First review of this PR (lastReviewedNow=0) — treat as 'created' so description update runs
      const effectivePrAction = lastReviewedNow === 0 ? ('created' as const) : opts.prAction
      console.log(`[review-runner] Azure PR ${prNumber}: reviewing iteration ${latestIteration}, compareToIteration=${lastReviewedNow}`)
      const result = await executeReview({ ...opts, prAction: effectivePrAction }, vcs, pool)
      await saveLastReviewedIteration(pool, repoId, prNumber, latestIteration)
      console.log(`[review-runner] Azure PR ${prNumber}: saved last_reviewed_iteration=${latestIteration}`)
      return result
    })
  }

  // 3. GitHub + non-incremental Azure (created events)
  const result = await executeReview(opts, vcs, pool)

  // 4. Save iteration for Azure created event so the first updated event is correctly gated
  if (platform === 'azure' && azureAdapter && !opts.dryRun) {
    try {
      const latestIteration = await azureAdapter.getLatestIterationId(prNumber)
      await saveLastReviewedIteration(pool, repoId, prNumber, latestIteration)
      console.log(`[review-runner] Azure PR ${prNumber} (created): saved last_reviewed_iteration=${latestIteration}`)
    } catch (err) {
      console.error(`[review-runner] Azure PR ${prNumber} (created): FAILED to save iteration state:`, (err as Error).message)
    }
  }

  return result
}

async function executeReview(opts: ReviewRunOptions, vcs: any, pool: Pool): Promise<{ verdict: string; commentCount: number; reviewId: string; comments?: any[] }> {
  const { platform, repoId, prNumber, baseBranch } = opts

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
      multiAgentEnabled: (process.env.MULTI_AGENT_ENABLED ?? 'false').toLowerCase() === 'true',
      reviewMode: ((process.env.REVIEW_MODE ?? 'single').toLowerCase() as 'single' | 'fast' | 'thorough' | 'auto'),
      enabledAgents: parseEnabledAgents(process.env.ENABLED_AGENTS),
      agentConcurrency: process.env.AGENT_CONCURRENCY ? parseInt(process.env.AGENT_CONCURRENCY, 10) : 2,
      judgeEnabled: (process.env.JUDGE_ENABLED ?? 'true').toLowerCase() !== 'false',
      judgeMode: (process.env.JUDGE_MODE ?? 'deterministic').toLowerCase() === 'llm' ? 'llm' : 'deterministic',
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
  const changedPaths = await fetchChangedPaths(vcs, prNumber)
  const orgId = await resolveRepoOrgId(pool, repoId)

  // Nothing to review — incremental diff was empty (e.g. no new commits since last review)
  if (!diffString || diffString.trim().length === 0) {
    console.log(`[review-runner] Empty diff for PR ${prNumber} — skipping review`)
    return { verdict: 'comment', commentCount: 0, reviewId: '' }
  }

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

  // Resolve org/repo/path scoped rule set and inject it into prompt context
  let applicableRules: RuleCandidate[] = []
  if (orgId) {
    applicableRules = await resolveApplicableRules(pool, orgId, repoId, changedPaths)
    if (applicableRules.length > 0) {
      if (!graphContext) {
        graphContext = {
          changedSymbols: [],
          callers: [],
          callees: [],
          blastRadius: { directCallers: [], transitiveCallers: [], affectedFiles: [], riskScore: 0 },
          semanticNeighbors: [],
        }
      }
      graphContext.enforcedRules = applicableRules.map(toEnforcedRuleContext)
    }
  }

  const result = opts.incrementalReview && platform === 'github'
    ? await agent.incrementalReview(prNumber, {}, graphContext)
    : await agent.review(prNumber, graphContext)
  const agentTelemetry = Array.isArray((result as any).agentTelemetry)
    ? (result as any).agentTelemetry
    : []
  if (agentTelemetry.length > 0) {
    console.log(
      `[review-runner] multi-agent telemetry for PR ${prNumber}: ${JSON.stringify(
        agentTelemetry.map((t: any) => ({
          role: t.role,
          durationMs: t.durationMs,
          commentCount: t.commentCount,
          verdict: t.verdict,
          error: t.error ?? null,
        })),
      )}`,
    )
  }

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
  const ruleSignals = applicableRules.length > 0
    ? evaluateRuleSignals(
      applicableRules,
      comments.map((c: any) => ({ path: c.path, line: c.line, body: c.body })),
    )
    : { evaluations: [], violations: [] }

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

  if (orgId && ruleSignals.evaluations.length > 0) {
    for (const evaluation of ruleSignals.evaluations) {
      await pool.query(
        `INSERT INTO rule_evaluations (id, rule_id, org_id, repo_id, review_id, pr_number, passed)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [crypto.randomUUID(), evaluation.ruleId, orgId, repoId, reviewId, prNumber, evaluation.passed],
      )
    }
  }

  if (orgId && ruleSignals.violations.length > 0) {
    for (const violation of ruleSignals.violations) {
      await pool.query(
        `INSERT INTO rule_violations (id, rule_id, org_id, repo_id, review_id, pr_number, file_path, line_number, comment_body, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')`,
        [
          crypto.randomUUID(),
          violation.ruleId,
          orgId,
          repoId,
          reviewId,
          prNumber,
          violation.filePath,
          violation.lineNumber,
          violation.commentBody,
        ],
      )
    }
  }

  if (orgId && agentTelemetry.length > 0) {
    for (const telemetry of agentTelemetry) {
      await pool.query(
        `INSERT INTO review_agent_telemetry (
           id, review_id, org_id, repo_id, pr_number, agent_role, verdict, comment_count, duration_ms, tokens_used, error
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          crypto.randomUUID(),
          reviewId,
          orgId,
          repoId,
          prNumber,
          String(telemetry.role ?? 'correctness'),
          String(telemetry.verdict ?? 'comment'),
          Number.isFinite(telemetry.commentCount) ? Number(telemetry.commentCount) : 0,
          Number.isFinite(telemetry.durationMs) ? Number(telemetry.durationMs) : 0,
          Number.isFinite(telemetry.tokensUsed) ? Number(telemetry.tokensUsed) : null,
          telemetry.error ? String(telemetry.error) : null,
        ],
      )
    }
  }

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
  // Resolve org-level defaults + repo-level overrides for PR description behavior
  const orgIdentityRows = await pool.query<{ slug: string }>(
    `SELECT o.slug
     FROM repos r
     JOIN organizations o ON o.id = r.org_id
     WHERE r.repo_id = $1
     LIMIT 1`,
    [repoId],
  )
  const orgKey = orgIdentityRows.rows[0]?.slug ?? 'default'
  const orgRows = await pool.query(
    `SELECT
       pr_description_enabled,
       pr_description_update_mode,
       pr_description_publish_mode,
       pr_description_preserve_original,
       pr_description_use_markers,
       pr_description_publish_labels
     FROM org_settings WHERE org_key = $1`,
    [orgKey],
  )
  const orgSettings = orgRows.rows[0]
    ? normalizeRepoPRDescriptionSettings(orgRows.rows[0] as any)
    : DEFAULT_REPO_PR_DESCRIPTION_SETTINGS

  const repoRows = await pool.query(
    `SELECT
       pr_description_enabled,
       pr_description_update_mode,
       pr_description_publish_mode,
       pr_description_preserve_original,
       pr_description_use_markers,
       pr_description_publish_labels
     FROM repo_settings WHERE repo_id = $1`,
    [repoId],
  )
  const repoOverrides = repoRows.rows[0]
    ? {
        enabled: repoRows.rows[0].pr_description_enabled as boolean | null,
        updateMode: repoRows.rows[0].pr_description_update_mode as any,
        publishMode: repoRows.rows[0].pr_description_publish_mode as any,
        preserveOriginal: repoRows.rows[0].pr_description_preserve_original as boolean | null,
        useMarkers: repoRows.rows[0].pr_description_use_markers as boolean | null,
        publishLabels: repoRows.rows[0].pr_description_publish_labels as boolean | null,
      }
    : {}
  const prSettings = resolveRepoPRDescriptionSettings(orgSettings, repoOverrides)

  const action = opts.prAction ?? 'manual'
  const shouldRunForAction = prSettings.updateMode === 'created_and_updated'
    ? (action === 'created' || action === 'updated' || action === 'opened' || action === 'synchronize' || action === 'manual')
    : (action === 'created' || action === 'opened' || action === 'manual')
  const shouldUpdatePRDescription =
    (opts.updatePRDescription ?? true) &&
    prSettings.enabled &&
    shouldRunForAction

  await agent.postReview(prNumber, result, {
    updatePRDescription: shouldUpdatePRDescription,
    prDescription: {
      publishMode: prSettings.publishMode,
      preserveOriginal: prSettings.preserveOriginal,
      useMarkers: prSettings.useMarkers,
      publishLabels: prSettings.publishLabels,
    },
  })

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

async function fetchChangedPaths(vcs: any, prNumber: number): Promise<string[]> {
  try {
    const diff = await vcs.getDiff(prNumber)
    return Array.isArray(diff.files)
      ? diff.files.map((f: any) => String(f.path ?? '').replace(/^\//, '')).filter(Boolean)
      : []
  } catch {
    return []
  }
}
