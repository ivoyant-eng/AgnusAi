import crypto from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getOrLoadRepo } from '../graph-cache'
import { runReview } from '../review-runner'
import { resolveCloneToken, buildAuthenticatedUrl } from '../git-utils'
import {
  normalizeGithubEvent,
  normalizeAzureEvent,
  markMergedViolations,
  type PREvent,
} from '../pr-event'
import { runAsk } from '../ask-runner'
import { runCommand } from '../command-runner'

const execAsync = promisify(exec)

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db
  const webhookSecret = process.env.WEBHOOK_SECRET ?? ''
  const webhookRateMax = parseInt(process.env.RATE_LIMIT_WEBHOOK_MAX ?? '120', 10)
  const webhookRateWindow = process.env.RATE_LIMIT_WEBHOOK_WINDOW ?? '1 minute'
  const webhookRateLimit = {
    max: Number.isFinite(webhookRateMax) && webhookRateMax > 0 ? webhookRateMax : 120,
    timeWindow: webhookRateWindow,
  }

  const canonicalizeRepoUrl = (raw: string): string => {
    try {
      const u = new URL(raw.trim())
      // Normalize Azure URL variants:
      // - https://user@dev.azure.com/org/project/_git/repo
      // - https://dev.azure.com/org/project/_git/repo
      const host = u.host.toLowerCase()
      const path = u.pathname.replace(/\/+$/, '').replace(/\.git$/, '')
      return `${u.protocol}//${host}${path}`.toLowerCase()
    } catch {
      return raw.trim().replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase()
    }
  }

  const resolveRepoId = async (repoUrl: string, orgSlug?: string): Promise<string | null> => {
    const incomingCanonical = canonicalizeRepoUrl(repoUrl)
    if (orgSlug) {
      const r = await pool.query<{ repo_id: string; repo_url: string }>(
        `SELECT r.repo_id, r.repo_url
         FROM repos r
         JOIN organizations o ON o.id = r.org_id
         WHERE r.repo_url = $1 AND o.slug = $2
         ORDER BY r.created_at DESC`,
        [repoUrl, orgSlug],
      )
      if (r.rows[0]) return r.rows[0].repo_id
      const candidates = await pool.query<{ repo_id: string; repo_url: string }>(
        `SELECT r.repo_id, r.repo_url
         FROM repos r
         JOIN organizations o ON o.id = r.org_id
         WHERE o.slug = $1
         ORDER BY r.created_at DESC`,
        [orgSlug],
      )
      const matched = candidates.rows.find(c => canonicalizeRepoUrl(c.repo_url) === incomingCanonical)
      return matched?.repo_id ?? null
    }
    const r = await pool.query<{ repo_id: string; repo_url: string }>(
      'SELECT repo_id, repo_url FROM repos WHERE repo_url = $1 ORDER BY created_at DESC LIMIT 1',
      [repoUrl],
    )
    if (r.rows[0]) return r.rows[0].repo_id
    const candidates = await pool.query<{ repo_id: string; repo_url: string }>(
      'SELECT repo_id, repo_url FROM repos ORDER BY created_at DESC',
    )
    const matched = candidates.rows.find(c => canonicalizeRepoUrl(c.repo_url) === incomingCanonical)
    return matched?.repo_id ?? null
  }

  // ─── Multi-org webhook endpoints ───────────────────────────────────────────
  app.post('/api/webhooks/github/:orgSlug', {
    config: { rawBody: true, rateLimit: webhookRateLimit },
  }, async (req, reply) => {
    const { orgSlug } = req.params as { orgSlug: string }
    const orgRes = await pool.query<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [orgSlug])
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'org not found' })
    const secretRes = await pool.query<{ secret: string }>(
      `SELECT secret FROM org_webhook_secrets WHERE org_id = $1 AND platform = 'github'`,
      [orgRes.rows[0].id],
    )
    const secret = secretRes.rows[0]?.secret || webhookSecret
    const sig = req.headers['x-hub-signature-256'] as string | undefined
    if (!verifyGitHubSignature(secret, req.rawBody ?? '', sig)) {
      return reply.status(401).send({ error: 'Invalid signature' })
    }
    const payload = req.body as Record<string, unknown>
    const event = req.headers['x-github-event'] as string
    const repoUrl = (payload.repository as any)?.html_url as string | undefined
    if (!repoUrl) return reply.status(200).send({ ok: true })
    const repoId = await resolveRepoId(repoUrl, orgSlug)
    if (!repoId) return reply.status(200).send({ ok: true })

    // @ryv / /ask command — intercept issue_comment before PR event normalization
    if (event === 'issue_comment' && payload.action === 'created') {
      const result = await handleRyvCommand(payload, repoId, repoUrl, pool, 'github')
      if (result) return reply.status(202).send({ status: 'command accepted' })
    }

    const prEvent = await normalizeGithubEvent(event, payload, repoId, repoUrl, pool)
    await dispatchPREvent(prEvent, pool)
    return reply.status(200).send({ ok: true })
  })

  app.post('/api/webhooks/azure/:orgSlug', { config: { rateLimit: webhookRateLimit } }, async (req, reply) => {
    const { orgSlug } = req.params as { orgSlug: string }
    const orgRes = await pool.query<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [orgSlug])
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'org not found' })
    const secretRes = await pool.query<{ secret: string }>(
      `SELECT secret FROM org_webhook_secrets WHERE org_id = $1 AND platform = 'azure'`,
      [orgRes.rows[0].id],
    )
    const secret = secretRes.rows[0]?.secret || webhookSecret
    const providedSecret = req.headers['x-webhook-secret'] as string | undefined
    if (!verifySharedWebhookSecret(secret, providedSecret)) {
      return reply.status(401).send({ error: 'Invalid webhook secret' })
    }
    const payload = req.body as Record<string, unknown>
    const resource = payload.resource as any
    const repoUrl = (resource?.repository?.remoteUrl ?? resource?.pullRequest?.repository?.remoteUrl) as string | undefined
    if (!repoUrl) return reply.status(200).send({ ok: true })
    const repoId = await resolveRepoId(repoUrl, orgSlug)
    if (!repoId) return reply.status(200).send({ ok: true })

    // @ryv command — intercept PR comment events
    if (payload.eventType === 'ms.vss-code.git-pullrequest-comment-event') {
      const result = await handleRyvCommandAzure(payload, repoId, repoUrl, pool)
      if (result) return reply.status(202).send({ status: 'command accepted' })
      return reply.status(200).send({ ok: true })
    }

    const prEvent = await normalizeAzureEvent(payload, repoId, repoUrl, pool)
    await dispatchPREvent(prEvent, pool)
    return reply.status(200).send({ ok: true })
  })

  // ─── GitHub ──────────────────────────────────────────────────────────────

  app.post('/api/webhooks/github', {
    config: { rawBody: true, rateLimit: webhookRateLimit },
  }, async (req, reply) => {
    const sig = req.headers['x-hub-signature-256'] as string | undefined
    if (!verifyGitHubSignature(webhookSecret, req.rawBody ?? '', sig)) {
      return reply.status(401).send({ error: 'Invalid signature' })
    }
    const event = req.headers['x-github-event'] as string
    const payload = req.body as Record<string, unknown>
    const repoUrl = (payload.repository as any)?.html_url as string | undefined
    if (!repoUrl) return reply.status(200).send({ ok: true })
    const repoId = await resolveRepoId(repoUrl)
    if (!repoId) return reply.status(200).send({ ok: true })

    // @ryv / /ask command — intercept issue_comment before PR event normalization
    if (event === 'issue_comment' && payload.action === 'created') {
      const result = await handleRyvCommand(payload, repoId, repoUrl, pool, 'github')
      if (result) return reply.status(202).send({ status: 'command accepted' })
    }

    const prEvent = await normalizeGithubEvent(event, payload, repoId, repoUrl, pool)
    await dispatchPREvent(prEvent, pool)
    return reply.status(200).send({ ok: true })
  })

  // ─── Azure DevOps ─────────────────────────────────────────────────────────

  app.post('/api/webhooks/azure', { config: { rateLimit: webhookRateLimit } }, async (req, reply) => {
    const providedSecret = req.headers['x-webhook-secret'] as string | undefined
    if (!verifySharedWebhookSecret(webhookSecret, providedSecret)) {
      return reply.status(401).send({ error: 'Invalid webhook secret' })
    }
    const payload = req.body as Record<string, unknown>
    const resource = payload.resource as any
    const repoUrl = (resource?.repository?.remoteUrl ?? resource?.pullRequest?.repository?.remoteUrl) as string | undefined
    if (!repoUrl) return reply.status(200).send({ ok: true })
    const repoId = await resolveRepoId(repoUrl)
    if (!repoId) return reply.status(200).send({ ok: true })

    // @ryv command — intercept PR comment events
    if (payload.eventType === 'ms.vss-code.git-pullrequest-comment-event') {
      const result = await handleRyvCommandAzure(payload, repoId, repoUrl, pool)
      if (result) return reply.status(202).send({ status: 'command accepted' })
      return reply.status(200).send({ ok: true })
    }

    const prEvent = await normalizeAzureEvent(payload, repoId, repoUrl, pool)
    await dispatchPREvent(prEvent, pool)
    return reply.status(200).send({ ok: true })
  })
}

// ─── @ryv / /ask command handler ─────────────────────────────────────────────

const RYV_BOT_NAME = process.env.RYV_BOT_NAME ?? 'ryv'
const COMMANDS_ENABLED = (process.env.COMMANDS_ENABLED ?? 'true').toLowerCase() !== 'false'

async function handleRyvCommand(
  payload: Record<string, unknown>,
  repoId: string,
  repoUrl: string,
  pool: Pool,
  platform: 'github' | 'azure',
): Promise<boolean> {
  if (!COMMANDS_ENABLED) return false

  const body = (payload.comment as any)?.body?.trim() ?? ''
  const isRyvMention = body.includes(`@${RYV_BOT_NAME}`)
  const isLegacyAsk  = body.startsWith('/ask ')

  if (!isRyvMention && !isLegacyAsk) return false

  // Only respond to PR issue comments (not plain issue comments on repos)
  const issue = payload.issue as any
  if (!issue?.pull_request) return false

  const prNumber = issue.number as number
  const commentId = (payload.comment as any)?.id as number
  const baseBranch = (issue.pull_request as any)?.base?.ref ?? 'main'

  const repoCreds = await getRepoCreds(pool, repoId)
  const token = repoCreds.token

  if (isLegacyAsk) {
    // Backward-compatible: route /ask directly to ask handler, skip NLP
    const question = body.slice('/ask '.length).trim()
    if (!question) return false
    setImmediate(() =>
      runCommand({ platform, repoId, repoUrl, prNumber, commentId, token, baseBranch, rawBody: body, pool, forceCommand: 'ask' })
        .catch(err => console.error('[command-runner] Error:', (err as Error).message))
    )
  } else {
    setImmediate(() =>
      runCommand({ platform, repoId, repoUrl, prNumber, commentId, token, baseBranch, rawBody: body, pool })
        .catch(err => console.error('[command-runner] Error:', (err as Error).message))
    )
  }
  return true
}

/** Handle Azure DevOps ms.vss-code.git-pullrequest-comment-event for @ryv commands */
async function handleRyvCommandAzure(
  payload: Record<string, unknown>,
  repoId: string,
  repoUrl: string,
  pool: Pool,
): Promise<boolean> {
  if (!COMMANDS_ENABLED) return false

  const resource = payload.resource as any
  const comment = resource?.comment
  const body = (comment?.content ?? '').trim()

  if (!body.includes(`@${RYV_BOT_NAME}`)) return false

  const pr = resource?.pullRequest
  const prNumber = (pr?.pullRequestId ?? resource?.pullRequestId) as number
  if (!prNumber) return false

  const commentId = comment?.id as number
  const threadId = (resource?.threadId ?? resource?.pullRequestThreadContext?.trackingCriteria?.firstComparingIteration) as number | undefined
  const baseBranch = (pr?.targetRefName ?? '').replace('refs/heads/', '') || 'main'

  const repoCreds = await getRepoCreds(pool, repoId)
  const token = repoCreds.token

  setImmediate(() =>
    runCommand({ platform: 'azure', repoId, repoUrl, prNumber, commentId, threadId, token, baseBranch, rawBody: body, pool })
      .catch(err => console.error('[command-runner] Error:', (err as Error).message))
  )
  return true
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatchPREvent(event: PREvent, pool: Pool): Promise<void> {
  const { kind, platform, repoId, repoUrl } = event
  switch (kind.type) {
    case 'skip':
      console.log(`[webhook:${platform}] Skipping: ${kind.reason}`)
      return

    case 'push_index':
      setImmediate(() => runPushIndex(pool, repoId, kind.branch, `[webhook:${platform}]`))
      return

    case 'pr_merged':
      await markMergedViolations(pool, repoId, kind.prNumber)
      return

    case 'pr_review': {
      const { prNumber, baseBranch, prAction, incrementalDiff, incrementalReview } = kind
      setImmediate(async () => {
        try {
          const repoCreds = await getRepoCreds(pool, repoId)
          await runReview({
            platform,
            repoId,
            repoUrl,
            prNumber,
            baseBranch,
            token: repoCreds.token,
            githubAppId: repoCreds.githubAppId,
            githubAppPrivateKey: repoCreds.githubAppPrivateKey,
            githubAppInstallationId: repoCreds.githubAppInstallationId,
            vcsInstallationId: repoCreds.vcsInstallationId,
            pool,
            incrementalDiff,
            incrementalReview,
            prAction,
          })
        } catch (err) {
          console.error(`[webhook:${platform}] Review failed for PR ${prNumber}:`, (err as Error).message)
        }
      })
      return
    }
  }
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

function verifySharedWebhookSecret(secret: string, provided?: string): boolean {
  if (!secret) return true
  if (!provided) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(provided))
  } catch {
    return false
  }
}

async function getRepoCreds(pool: Pool, repoId: string): Promise<{ token?: string; githubAppId?: string; githubAppPrivateKey?: string; githubAppInstallationId?: string; vcsInstallationId?: string }> {
  const res = await pool.query<{ token: string | null; github_app_id: string | null; github_app_private_key: string | null; github_app_installation_id: string | null; vcs_installation_id: string | null }>(
    'SELECT token, github_app_id, github_app_private_key, github_app_installation_id, vcs_installation_id FROM repos WHERE repo_id = $1',
    [repoId],
  )
  const row = res.rows[0]
  if (!row) return {}
  return {
    token: row.token ?? undefined,
    githubAppId: row.github_app_id ?? undefined,
    githubAppPrivateKey: row.github_app_private_key ?? undefined,
    githubAppInstallationId: row.github_app_installation_id ?? undefined,
    vcsInstallationId: row.vcs_installation_id ?? undefined,
  }
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
    const repoRow = await pool.query<{
      repo_path: string | null
      repo_url: string | null
      token: string | null
      github_app_id: string | null
      github_app_private_key: string | null
      github_app_installation_id: string | null
    }>(
      'SELECT repo_path, repo_url, token, github_app_id, github_app_private_key, github_app_installation_id FROM repos WHERE repo_id = $1',
      [repoId],
    )
    const repoMeta = repoRow.rows[0]
    const repoPath = repoMeta?.repo_path ?? undefined
    if (!repoPath) {
      console.warn(`${logPrefix} No repo_path for ${repoId} — skipping index`)
      return
    }

    // Generate a fresh clone token — GitHub App installation tokens expire after 1 hour
    const freshToken = await resolveCloneToken(
      repoMeta?.github_app_id,
      repoMeta?.github_app_private_key,
      repoMeta?.github_app_installation_id,
      repoMeta?.token,
    )
    if (freshToken && repoMeta?.repo_url) {
      const freshUrl = buildAuthenticatedUrl(repoMeta.repo_url, freshToken)
      await execAsync(`git -C "${repoPath}" remote set-url origin "${freshUrl}"`, { timeout: 10_000 }).catch(() => {})
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
