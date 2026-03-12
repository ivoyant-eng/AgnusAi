/**
 * Fix command handler — @ryv fix this / @ryv fix <description>
 *
 * Flow (async job pattern):
 * 1. Immediate ACK: insert fix_job row → reply "Working on it..." → return in <100ms
 * 2. Background job (setImmediate):
 *    a. Create git worktree from source branch
 *    b. Call OpenCode; race against pollUntilStable (30s interval, stable for 2 rounds)
 *    c. Read changed files from worktree, create branch from source branch, open PR
 *    d. Post follow-up reply with PR URL
 *    e. Cleanup worktree
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { CommandHandler, CommandContext, CommandIntent, GraphCacheEntry } from '../types'
import type { VCSAdapter } from '../../adapters/vcs/base'
import type { LLMBackend } from '../../llm/base'
import {
  buildFixPrompt,
  getLocalRepoPath,
  gitDiffFiles,
  hasAgenticSupport,
  callOpenCode,
  buildAuthenticatedUrl,
  pollUntilStable,
} from './shared'

const execAsync = promisify(exec)

// ─── Immediate handler (fast path) ─────────────────────────────────────────

export const handleFix: CommandHandler = async (ctx, intent, vcs, llm, graphEntry) => {
  if (!hasAgenticSupport(vcs)) {
    return { reply: '**@ryv** Fix PRs are not yet supported for this VCS platform.' }
  }

  const repoPath = await getLocalRepoPath(ctx.repoId, ctx.pool)
  if (!repoPath) {
    return { reply: '**@ryv** Cannot fix — this repo has not been indexed locally yet. Please trigger an index first.' }
  }

  // Deduplication: reject if a job is already running for this PR
  const db = ctx.pool as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }
  try {
    const existing = await db.query(
      `SELECT id FROM fix_jobs WHERE repo_id = $1 AND pr_number = $2 AND status IN ('pending','running')`,
      [ctx.repoId, ctx.prNumber],
    )
    if (existing.rows.length > 0) {
      return { reply: '**@ryv** A fix is already in progress for this PR. Please wait for it to complete.' }
    }

    const jobId = randomUUID()
    await db.query(
      `INSERT INTO fix_jobs (id, repo_id, pr_number, platform, thread_id, comment_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [jobId, ctx.repoId, ctx.prNumber, ctx.platform, ctx.threadId ?? null, ctx.commentId],
    )

    // Spawn background job — does not block the webhook response
    setImmediate(() =>
      runFixJob(jobId, ctx, intent, vcs, llm, graphEntry, repoPath).catch(err =>
        console.error('[fix-job]', jobId, 'unhandled error:', err.message),
      ),
    )
  } catch (err: any) {
    // DB unavailable — fall through to synchronous mode rather than silently dropping the request
    console.warn('[fix] DB unavailable, running synchronously:', err.message)
    setImmediate(() =>
      runFixJob(randomUUID(), ctx, intent, vcs, llm, graphEntry, repoPath).catch(err2 =>
        console.error('[fix-job] unhandled error:', err2.message),
      ),
    )
  }

  return { reply: '⚙️ **@ryv** is working on it — I\'ll reply here when the fix PR is ready.' }
}

// ─── Background job ─────────────────────────────────────────────────────────

async function postFollowUp(ctx: CommandContext, vcs: VCSAdapter, body: string): Promise<void> {
  try {
    if (ctx.platform === 'github') {
      await (vcs as any).replyToComment(ctx.prNumber, ctx.commentId, body)
    } else if (ctx.platform === 'azure' && ctx.threadId !== undefined) {
      await (vcs as any).replyToThread(ctx.prNumber, ctx.threadId, body)
    } else {
      await vcs.addComment(ctx.prNumber, { path: '', line: 0, body, severity: 'info' })
    }
  } catch (err: any) {
    console.error('[fix-job] Failed to post follow-up comment:', err.message)
  }
}

async function updateJobStatus(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  jobId: string,
  fields: { status?: string; worktree_path?: string; branch_name?: string; pr_url?: string; error?: string },
): Promise<void> {
  const sets: string[] = ['updated_at = NOW()']
  const vals: unknown[] = [jobId]
  let i = 2
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) { sets.push(`${k} = $${i++}`); vals.push(v) }
  }
  await db.query(`UPDATE fix_jobs SET ${sets.join(', ')} WHERE id = $1`, vals).catch(() => {})
}

async function runFixJob(
  jobId: string,
  ctx: CommandContext,
  intent: CommandIntent,
  vcs: VCSAdapter,
  llm: LLMBackend,
  graphEntry: GraphCacheEntry | undefined,
  repoPath: string,
): Promise<void> {
  const db = ctx.pool as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }

  // Fetch PR metadata
  const pr = await vcs.getPR(ctx.prNumber)
  const sourceBranch = (pr as any).sourceBranch?.replace('refs/heads/', '') ?? ctx.baseBranch
  const diff = await vcs.getDiff(ctx.prNumber)

  // Create isolated git worktree
  const worktreeBase = join(repoPath, '..', 'worktrees')
  const worktreePath = join(worktreeBase, `fix-${ctx.prNumber}-${Date.now()}`)
  let worktreeReady = false

  try {
    await execAsync(`mkdir -p "${worktreeBase}"`, { timeout: 5_000 })

    // Refresh remote URL with stored token so fetch succeeds even after OAuth2 JWT expiry
    if (ctx.token && ctx.repoUrl) {
      const freshUrl = buildAuthenticatedUrl(ctx.repoUrl, ctx.token)
      await execAsync(`git -C "${repoPath}" remote set-url origin "${freshUrl}"`, { timeout: 10_000 }).catch(() => {})
    }

    await execAsync(`git -C "${repoPath}" fetch origin "${sourceBranch}"`, { timeout: 30_000 })
    await execAsync(`git -C "${repoPath}" worktree add "${worktreePath}" FETCH_HEAD`, { timeout: 15_000 })
    worktreeReady = true
    console.log(`[fix-job] ${jobId} worktree at ${worktreePath} (branch: ${sourceBranch})`)

    await updateJobStatus(db, jobId, { status: 'running', worktree_path: worktreePath })
  } catch (err: any) {
    await updateJobStatus(db, jobId, { status: 'failed', error: err.message })
    await postFollowUp(ctx, vcs, `**@ryv** Could not prepare worktree for branch \`${sourceBranch}\`: ${err.message}`)
    return
  }

  const cleanupWorktree = async () => {
    if (!worktreeReady) return
    try {
      await execAsync(`git -C "${repoPath}" worktree remove --force "${worktreePath}"`, { timeout: 15_000 })
      console.log(`[fix-job] ${jobId} worktree cleaned up`)
    } catch { /* best-effort */ }
  }

  try {
    // Get graph context for blast radius (best-effort, 10s timeout)
    let graphContext = null
    if (graphEntry) {
      try {
        const diffStr = diff.files.map(f => f.hunks.map(h => h.content).join('\n')).join('\n')
        graphContext = await Promise.race([
          graphEntry.retriever.getReviewContext(diffStr, ctx.repoId),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
        ])
      } catch { /* graph context is best-effort */ }
    }

    const prompt = buildFixPrompt({
      // Use the full raw user query (all requirements preserved) rather than the
      // classifier's potentially-shortened intent.query refinement.
      request: ctx.userQuery || intent.query,
      prTitle: pr.title,
      prDescription: pr.description,
      diff,
      graphContext,
      baseBranch: ctx.baseBranch,
      worktreePath,
    })

    const OPENCODE_URL = process.env.OPENCODE_URL ?? 'http://opencode:4096'
    const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? ''

    // Race: OpenCode SSE completion vs git-diff stability polling (30s × 20 = 10 min max)
    // Whichever signals done first wins — the other is abandoned (worktree cleaned up anyway).
    let timedOut = false
    try {
      const [result] = await Promise.race([
        callOpenCode(OPENCODE_URL, OPENCODE_PASSWORD, worktreePath, prompt, 300_000)
          .then(r => [r] as const),
        pollUntilStable(worktreePath, 30_000, 20, 2)
          .then(p => [{ output: '', timedOut: p.timedOut }] as const),
      ])
      timedOut = result.timedOut
    } catch (err: any) {
      await updateJobStatus(db, jobId, { status: 'failed', error: err.message })
      await postFollowUp(ctx, vcs, `**@ryv** OpenCode is not available: ${err.message}. Is the sidecar running?`)
      return
    }

    // Check what OpenCode actually changed in the worktree
    const changedFiles = await gitDiffFiles(worktreePath, ctx.baseBranch)

    if (changedFiles.length === 0) {
      const msg = timedOut
        ? '**@ryv** Fix timed out after 10 minutes with no file changes. The task may be too complex — try a more specific request.'
        : '**@ryv** OpenCode ran but made no file changes. Try rephrasing the request with more context.'
      await updateJobStatus(db, jobId, { status: 'failed', error: 'no changes' })
      await postFollowUp(ctx, vcs, msg)
      return
    }

    // Create branch from source branch, commit, open PR
    const shortDesc = intent.query.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30)
    const branchName = `ryv/fix/${ctx.prNumber}-${shortDesc}-${Date.now().toString(36)}`
    await updateJobStatus(db, jobId, { branch_name: branchName })

    try {
      // Branch from the PR's source branch so the files exist there
      await vcs.createBranch!(branchName, sourceBranch)

      const { readFileSync } = await import('fs')
      const files = changedFiles.map(f => ({
        path: f,
        content: readFileSync(join(worktreePath, f), 'utf8'),
      }))

      await vcs.commitFiles!(branchName, files, `fix: ${intent.query.slice(0, 72)}`)

      const newPR = await vcs.openPR!({
        title: `fix: ${intent.query.slice(0, 72)}`,
        body: buildPRBody(ctx, intent, changedFiles, graphContext),
        head: branchName,
        base: sourceBranch,
      })

      await updateJobStatus(db, jobId, { status: 'done', pr_url: newPR.url })

      await postFollowUp(
        ctx, vcs,
        `**@ryv** Fix PR opened: ${newPR.url}\n\n` +
        `Changed ${changedFiles.length} file(s): ${changedFiles.map(f => `\`${f}\``).join(', ')}\n\n` +
        `> Review carefully before merging.`,
      )
    } catch (err: any) {
      await updateJobStatus(db, jobId, { status: 'failed', error: err.message })
      await postFollowUp(ctx, vcs, `**@ryv** Could not open PR: ${err.message}`)
    }
  } finally {
    await cleanupWorktree()
  }
}

function buildPRBody(ctx: CommandContext, intent: CommandIntent, changedFiles: string[], graphContext: any): string {
  return [
    '## Ryv Autonomous Fix',
    '',
    `**Triggered by:** Comment on #${ctx.prNumber}`,
    `**Request:** ${intent.query}`,
    '',
    '### Changed Files',
    changedFiles.map(f => `- \`${f}\``).join('\n'),
    '',
    graphContext?.blastRadius?.callers?.length
      ? `### Blast Radius Checked\n${graphContext.blastRadius.callers.map((c: any) => `- ${c.name} (${c.filePath})`).join('\n')}`
      : '',
    '',
    '### Checklist',
    '- [ ] Review the diff carefully',
    '- [ ] Run tests locally',
    '- [ ] Approve and merge when satisfied',
    '',
    '---',
    '*This PR was opened autonomously by Ryv. Human approval required before merge.*',
  ].filter(l => l !== null).join('\n')
}
