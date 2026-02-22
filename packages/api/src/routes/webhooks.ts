import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getOrLoadRepo } from '../graph-cache'
import { runReview } from '../review-runner'

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
      // Incremental index for changed files
      const commits = (payload.commits as any[]) ?? []
      const changedFiles: string[] = []
      for (const commit of commits) {
        changedFiles.push(...(commit.added ?? []))
        changedFiles.push(...(commit.modified ?? []))
        changedFiles.push(...(commit.removed ?? []))
      }
      const uniqueFiles = [...new Set(changedFiles)]

      if (uniqueFiles.length > 0) {
        setImmediate(async () => {
          try {
            const entry = await getOrLoadRepo(repoId)
            await entry.indexer.incrementalUpdate(uniqueFiles, repoId)
          } catch (err) {
            console.error('[webhook] Incremental index failed:', (err as Error).message)
          }
        })
      }
    } else if (event === 'pull_request') {
      const action = payload.action as string
      if (action === 'opened' || action === 'synchronize') {
        const prNumber = (payload.pull_request as any)?.number as number
        const diff = (payload.pull_request as any)?.diff_url as string | undefined

        setImmediate(async () => {
          try {
            await runReview({
              platform: 'github',
              repoId,
              repoUrl,
              prNumber,
              token: await getRepoToken(pool, repoId),
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
      const commits = (payload.resource as any)?.commits as any[] ?? []
      const changedFiles: string[] = []
      for (const commit of commits) {
        const changes = commit.changes ?? []
        for (const change of changes) {
          changedFiles.push(change.item?.path?.replace(/^\//, '') ?? '')
        }
      }
      const uniqueFiles = [...new Set(changedFiles.filter(Boolean))]

      if (uniqueFiles.length > 0) {
        setImmediate(async () => {
          try {
            const entry = await getOrLoadRepo(repoId)
            await entry.indexer.incrementalUpdate(uniqueFiles, repoId)
          } catch (err) {
            console.error('[webhook:azure] Incremental index failed:', (err as Error).message)
          }
        })
      }
    } else if (
      eventType === 'git.pullrequest.created' ||
      eventType === 'git.pullrequest.updated'
    ) {
      const prId = (payload.resource as any)?.pullRequestId as number
      setImmediate(async () => {
        try {
          await runReview({
            platform: 'azure',
            repoId,
            repoUrl,
            prNumber: prId,
            token: await getRepoToken(pool, repoId),
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
