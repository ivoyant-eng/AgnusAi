import crypto from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getOrLoadRepo } from '../graph-cache'
import { runReview } from '../review-runner'

const execAsync = promisify(exec)

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db
  const webhookSecret = process.env.WEBHOOK_SECRET ?? ''

  // ─── GitHub ──────────────────────────────────────────────────────────────

  app.post('/api/webhooks/github', {
    config: { rawBody: true },
  }, async (req, reply) => {
    // Verify signature
    const sig = req.headers['x-hub-signature-256'] as string | undefined
    if (!verifyGitHubSignature(webhookSecret, req.rawBody ?? '', sig)) {
      return reply.status(401).send({ error: 'Invalid signature' })
    }

    const event = req.headers['x-github-event'] as string
    const payload = req.body as Record<string, unknown>

    // Look up repoId from the push or PR payload
    const repoUrl = (payload.repository as any)?.html_url as string | undefined
    if (!repoUrl) return reply.status(200).send({ ok: true })

    const repoId = Buffer.from(repoUrl).toString('base64url').slice(0, 32)

    if (event === 'push') {
      // Extract the branch from refs/heads/<branch>
      const branch = ((payload.ref as string) ?? '').replace('refs/heads/', '') || 'main'

      // Only update if this branch is indexed
      const isBranchIndexed = await isIndexedBranch(pool, repoId, branch)
      if (!isBranchIndexed) {
        return reply.status(200).send({ ok: true })
      }

      setImmediate(() => runPushIndex(pool, repoId, branch, '[webhook]'))
    } else if (event === 'pull_request') {
      const action = payload.action as string
      if (action === 'opened' || action === 'synchronize') {
        const prNumber = (payload.pull_request as any)?.number as number
        const baseBranch = ((payload.pull_request as any)?.base?.ref as string) ?? 'main'
        // On re-push, use checkpoint-based incremental review (only new commits)
        const incrementalReview = action === 'synchronize'

        setImmediate(async () => {
          try {
            await runReview({
              platform: 'github',
              repoId,
              repoUrl,
              prNumber,
              baseBranch,
              token: await getRepoToken(pool, repoId),
              pool,
              incrementalReview,
            })
          } catch (err) {
            console.error('[webhook] Review failed for PR', prNumber, (err as Error).message)
          }
        })
      }
    }

    return reply.status(200).send({ ok: true })
  })

  // ─── Azure DevOps ─────────────────────────────────────────────────────────

  app.post('/api/webhooks/azure', async (req, reply) => {
    const payload = req.body as Record<string, unknown>
    const eventType = payload.eventType as string | undefined

    // Extract repo URL from Azure payload
    const repoUrl = (payload.resource as any)?.repository?.remoteUrl as string | undefined
    if (!repoUrl) return reply.status(200).send({ ok: true })

    const repoId = Buffer.from(repoUrl).toString('base64url').slice(0, 32)

    if (eventType === 'git.push') {
      // Extract branch from refUpdates[0].name (refs/heads/<branch>)
      const refUpdates = (payload.resource as any)?.refUpdates as any[] ?? []
      const branch = ((refUpdates[0]?.name as string) ?? '').replace('refs/heads/', '') || 'main'

      // Only update if this branch is indexed
      const isBranchIndexed = await isIndexedBranch(pool, repoId, branch)
      if (!isBranchIndexed) {
        return reply.status(200).send({ ok: true })
      }

      setImmediate(() => runPushIndex(pool, repoId, branch, '[webhook:azure]'))
    } else if (
      eventType === 'git.pullrequest.created' ||
      eventType === 'git.pullrequest.updated'
    ) {
      const prId = (payload.resource as any)?.pullRequestId as number
      const targetRef = ((payload.resource as any)?.targetRefName as string) ?? 'refs/heads/main'
      const baseBranch = targetRef.replace('refs/heads/', '') || 'main'
      // On re-push, only diff the new commits (latest vs previous iteration)
      const incrementalDiff = eventType === 'git.pullrequest.updated'

      setImmediate(async () => {
        try {
          await runReview({
            platform: 'azure',
            repoId,
            repoUrl,
            prNumber: prId,
            baseBranch,
            token: await getRepoToken(pool, repoId),
            pool,
            incrementalDiff,
          })
        } catch (err) {
          console.error('[webhook:azure] Review failed for PR', prId, (err as Error).message)
        }
      })
    }

    return reply.status(200).send({ ok: true })
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function verifyGitHubSignature(secret: string, rawBody: string | Buffer, sig?: string): boolean {
  if (!secret) return true // No secret configured — skip verification
  if (!sig) return false
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(rawBody)
  const expected = `sha256=${hmac.digest('hex')}`
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  } catch {
    return false
  }
}

async function getRepoToken(pool: Pool, repoId: string): Promise<string | undefined> {
  const res = await pool.query<{ token: string | null }>(
    'SELECT token FROM repos WHERE repo_id = $1',
    [repoId],
  )
  return res.rows[0]?.token ?? undefined
}

/**
 * Pull the clone and return files changed since the previous HEAD via git diff.
 * Works for both GitHub and Azure — no payload file list needed.
 */
async function getChangedFilesFromGit(repoPath: string): Promise<string[]> {
  try {
    await execAsync(
      `git -C "${repoPath}" fetch --depth=1 origin && git -C "${repoPath}" reset --hard origin/HEAD`,
      { timeout: 60_000 },
    )
    const { stdout } = await execAsync(
      `git -C "${repoPath}" diff --name-only ORIG_HEAD HEAD 2>/dev/null`,
      { timeout: 30_000 },
    )
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Shared push-index handler for GitHub and Azure git.push events.
 * - If no symbols exist yet → full index (fallback for unindexed repos)
 * - Otherwise → incremental update of only the changed files
 */
async function runPushIndex(pool: Pool, repoId: string, branch: string, logPrefix: string): Promise<void> {
  try {
    const repoPathRow = await pool.query<{ repo_path: string | null }>(
      'SELECT repo_path FROM repos WHERE repo_id = $1', [repoId],
    )
    const repoPath = repoPathRow.rows[0]?.repo_path ?? undefined
    if (!repoPath) {
      console.warn(`${logPrefix} No repo_path for ${repoId} — skipping index`)
      return
    }

    // Check if an index exists
    const { rows } = await pool.query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM symbols WHERE repo_id = $1', [repoId],
    )
    const symbolCount = parseInt(rows[0]?.cnt ?? '0')

    if (symbolCount === 0) {
      // No index yet — pull and run full index as fallback
      console.log(`${logPrefix} No symbols for ${repoId}, running full index`)
      await execAsync(
        `git -C "${repoPath}" fetch --depth=1 origin && git -C "${repoPath}" reset --hard origin/HEAD`,
        { timeout: 60_000 },
      )
      const entry = await getOrLoadRepo(repoId, branch)
      const stats = await entry.indexer.fullIndex(repoPath, repoId, branch)
      await pool.query(
        'UPDATE repos SET indexed_at = NOW(), symbol_count = $1 WHERE repo_id = $2',
        [stats.symbolCount, repoId],
      )
      console.log(`${logPrefix} Full index complete: ${stats.symbolCount} symbols`)
    } else {
      // Incremental — pull and diff to find changed files
      const changedFiles = await getChangedFilesFromGit(repoPath)
      if (changedFiles.length === 0) {
        console.log(`${logPrefix} No changed files detected for ${repoId}`)
        return
      }
      console.log(`${logPrefix} Incremental update for ${repoId}: ${changedFiles.join(', ')}`)
      const entry = await getOrLoadRepo(repoId, branch)
      await entry.indexer.incrementalUpdate(changedFiles, repoId, branch, repoPath)
      // Keep symbol_count in sync
      const { rows: countRows } = await pool.query<{ cnt: string }>(
        'SELECT COUNT(*) as cnt FROM symbols WHERE repo_id = $1', [repoId],
      )
      await pool.query(
        'UPDATE repos SET symbol_count = $1 WHERE repo_id = $2',
        [parseInt(countRows[0]?.cnt ?? '0'), repoId],
      )
    }
  } catch (err) {
    console.error(`${logPrefix} Push index failed for ${repoId}:`, (err as Error).message)
  }
}

/**
 * Check if a branch is registered in repo_branches.
 * Returns true only if the repo_branches table doesn't exist yet (graceful degradation
 * for deployments that haven't migrated). All other DB errors are re-thrown.
 */
async function isIndexedBranch(pool: Pool, repoId: string, branch: string): Promise<boolean> {
  try {
    const res = await pool.query(
      'SELECT 1 FROM repo_branches WHERE repo_id = $1 AND branch = $2',
      [repoId, branch],
    )
    return res.rows.length > 0
  } catch (err: any) {
    if (err?.code === '42P01') return true // table does not exist — backwards compat
    throw err
  }
}
