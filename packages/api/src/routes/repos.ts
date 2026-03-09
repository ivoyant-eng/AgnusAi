import { existsSync, mkdirSync } from 'fs'
import { exec, type ExecException } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'

const execAsync = promisify(exec)

/** Directory where repos are auto-cloned when no repoPath is provided */
const REPOS_DIR = process.env.REPOS_DIR ?? '/repos'
import { createDefaultRegistry, Indexer, InMemorySymbolGraph, PostgresStorageAdapter } from '@agnus-ai/core'
import type { IndexProgress } from '@agnus-ai/shared'
import { loadRepo, getOrLoadRepo, evictRepo } from '../graph-cache'
import { createEmbeddingAdapter } from '../embedding-factory'
import { resolveCloneToken, buildAuthenticatedUrl } from '../git-utils'
import { requireAuth, requireOrgAdmin } from '../auth/middleware'
import { isVcsPlatform, type AuthJwtClaims, type VcsPlatform } from '../auth/types'
import { runReview } from '../review-runner'
import { buildAzureAuthUrl, exchangeAzureCode, getAzureOAuthToken } from '../azure-oauth'
import {
  DEFAULT_REPO_PR_DESCRIPTION_SETTINGS,
  normalizeRepoPRDescriptionSettings,
  resolveRepoPRDescriptionSettings,
  type PRDescriptionPublishMode,
  type PRDescriptionUpdateMode,
} from '../repo-settings'

export async function repoRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db
  const activeOrg = (req: FastifyRequest | { user: AuthJwtClaims }): string | null =>
    (req as { user: AuthJwtClaims }).user?.activeOrgId ?? null
  const isSystemAdmin = (req: FastifyRequest | { user: AuthJwtClaims }): boolean =>
    Boolean((req as { user: AuthJwtClaims }).user?.isSystemAdmin)
  const getAccessibleRepo = async (req: FastifyRequest | { user: AuthJwtClaims }, repoId: string) => {
    const orgId = activeOrg(req)
    const { rows } = await pool.query(
      isSystemAdmin(req) && !orgId
        ? 'SELECT repo_id, repo_url, platform, indexed_at, symbol_count, created_at, org_id FROM repos WHERE repo_id = $1'
        : 'SELECT repo_id, repo_url, platform, indexed_at, symbol_count, created_at, org_id FROM repos WHERE repo_id = $1 AND org_id = $2',
      isSystemAdmin(req) && !orgId ? [repoId] : [repoId, orgId],
    )
    return rows[0] as
      | {
          repo_id: string
          repo_url: string
          platform: 'github' | 'azure'
          indexed_at: string | null
          symbol_count: number | null
          created_at: string
          org_id: string
        }
      | undefined
  }

  /**
   * GET /api/repos — list all registered repos (auth required)
   */
  app.get('/api/repos', { preHandler: [requireAuth] }, async (req, reply) => {
    const orgId = activeOrg(req)
    const { rows } = isSystemAdmin(req) && !orgId
      ? await pool.query(
          'SELECT repo_id, repo_url, platform, repo_path, indexed_at, symbol_count, created_at, github_app_id, github_app_installation_id, vcs_installation_id FROM repos ORDER BY created_at DESC',
        )
      : await pool.query(
          'SELECT repo_id, repo_url, platform, repo_path, indexed_at, symbol_count, created_at, github_app_id, github_app_installation_id, vcs_installation_id FROM repos WHERE org_id = $1 ORDER BY created_at DESC',
          [orgId],
        )
    return reply.send(rows.map((r: any) => ({
      repoId: r.repo_id,
      repoUrl: r.repo_url,
      platform: r.platform,
      repoPath: r.repo_path,
      indexedAt: r.indexed_at,
      symbolCount: r.symbol_count ?? 0,
      createdAt: r.created_at,
      githubAppId: r.github_app_id ?? null,
      githubAppInstallationId: r.github_app_installation_id ?? null,
      vcsInstallationId: r.vcs_installation_id ?? null,
    })))
  })

  app.get('/api/orgs', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { rows } = isSystemAdmin(req)
      ? await pool.query(
          `SELECT o.id, o.slug, o.name, COALESCE(MIN(r.platform), 'github') AS platform
           FROM organizations o
           LEFT JOIN repos r ON r.org_id = o.id
           GROUP BY o.id, o.slug, o.name
           ORDER BY o.name ASC`,
        )
      : await pool.query(
          `SELECT o.id, o.slug, o.name, COALESCE(MIN(r.platform), 'github') AS platform
           FROM org_members om
           JOIN organizations o ON o.id = om.org_id
           LEFT JOIN repos r ON r.org_id = o.id
           WHERE om.user_id = $1
           GROUP BY o.id, o.slug, o.name
           ORDER BY o.name ASC`,
          [user.id],
        )
    return reply.send(rows.map((r: any) => ({
      orgId: r.id,
      orgKey: r.slug,
      orgName: r.name,
      platform: r.platform,
    })))
  })

  app.get('/api/orgs/:orgKey/settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const { orgKey } = req.params as { orgKey: string }
    const user = req.user as AuthJwtClaims
    if (!isSystemAdmin(req)) {
      const m = await pool.query(
        `SELECT 1
         FROM org_members om
         JOIN organizations o ON o.id = om.org_id
         WHERE om.user_id = $1 AND o.slug = $2`,
        [user.id, orgKey],
      )
      if (m.rows.length === 0) return reply.status(403).send({ error: 'Forbidden' })
    }
    const { rows } = await pool.query(
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
    const prDescription = rows[0]
      ? normalizeRepoPRDescriptionSettings(rows[0])
      : DEFAULT_REPO_PR_DESCRIPTION_SETTINGS
    return reply.send({ orgKey, prDescription })
  })

  app.post('/api/orgs/:orgKey/settings', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const { orgKey } = req.params as { orgKey: string }
    const body = req.body as {
      platform: 'github' | 'azure'
      orgName: string
      prDescription?: Partial<{
        enabled: boolean
        updateMode: PRDescriptionUpdateMode
        publishMode: PRDescriptionPublishMode
        preserveOriginal: boolean
        useMarkers: boolean
        publishLabels: boolean
      }>
    }
    if (!body.platform || !body.orgName) {
      return reply.status(400).send({ error: 'platform and orgName are required' })
    }
    const next = { ...DEFAULT_REPO_PR_DESCRIPTION_SETTINGS, ...(body.prDescription ?? {}) }
    if (next.updateMode !== 'created_only' && next.updateMode !== 'created_and_updated') {
      return reply.status(400).send({ error: 'Invalid updateMode' })
    }
    if (next.publishMode !== 'replace_pr' && next.publishMode !== 'comment') {
      return reply.status(400).send({ error: 'Invalid publishMode' })
    }
    await pool.query(
      `INSERT INTO org_settings (
         org_key, platform, org_name,
         pr_description_enabled,
         pr_description_update_mode,
         pr_description_publish_mode,
         pr_description_preserve_original,
         pr_description_use_markers,
         pr_description_publish_labels,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (org_key) DO UPDATE SET
         platform = EXCLUDED.platform,
         org_name = EXCLUDED.org_name,
         pr_description_enabled = EXCLUDED.pr_description_enabled,
         pr_description_update_mode = EXCLUDED.pr_description_update_mode,
         pr_description_publish_mode = EXCLUDED.pr_description_publish_mode,
         pr_description_preserve_original = EXCLUDED.pr_description_preserve_original,
         pr_description_use_markers = EXCLUDED.pr_description_use_markers,
         pr_description_publish_labels = EXCLUDED.pr_description_publish_labels,
         updated_at = NOW()`,
      [
        orgKey,
        body.platform,
        body.orgName,
        next.enabled,
        next.updateMode,
        next.publishMode,
        next.preserveOriginal,
        next.useMarkers,
        next.publishLabels,
      ],
    )
    return reply.send({ ok: true, orgKey, prDescription: next })
  })

  app.get('/api/orgs/:orgKey/members', { preHandler: [requireAuth] }, async (req, reply) => {
    const { orgKey } = req.params as { orgKey: string }
    const user = req.user as AuthJwtClaims
    if (!isSystemAdmin(req)) {
      const m = await pool.query(
        `SELECT 1
         FROM org_members om
         JOIN organizations o ON o.id = om.org_id
         WHERE om.user_id = $1 AND o.slug = $2`,
        [user.id, orgKey],
      )
      if (m.rows.length === 0) return reply.status(403).send({ error: 'Forbidden' })
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.email, om.role, om.joined_at
       FROM org_members om
       JOIN organizations o ON o.id = om.org_id
       JOIN users u ON u.id = om.user_id
       WHERE o.slug = $1
       ORDER BY u.email ASC`,
      [orgKey],
    )
    return reply.send(rows.map((r: any) => ({
      userId: r.id,
      email: r.email,
      role: r.role,
      joinedAt: r.joined_at,
    })))
  })

  app.get('/api/orgs/:orgKey/webhooks', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const { orgKey } = req.params as { orgKey: string }
    const orgRes = await pool.query<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [orgKey])
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'org not found' })
    const orgId = orgRes.rows[0].id
    const { rows } = await pool.query<{ platform: string; secret: string }>(
      'SELECT platform, secret FROM org_webhook_secrets WHERE org_id = $1 ORDER BY platform ASC',
      [orgId],
    )
    const webhooks = rows.map(r => ({
      platform: r.platform,
      path: `/api/webhooks/${r.platform}/${orgKey}`,
      secretPreview: `${r.secret.slice(0, 6)}...${r.secret.slice(-4)}`,
    }))
    return reply.send({ orgKey, webhooks })
  })

  app.post('/api/orgs/:orgKey/webhooks/rotate', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const { orgKey } = req.params as { orgKey: string }
    const { platform } = req.body as { platform?: VcsPlatform }
    if (!isVcsPlatform(platform)) {
      return reply.status(400).send({ error: 'platform must be github or azure' })
    }
    const orgRes = await pool.query<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [orgKey])
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'org not found' })
    const orgId = orgRes.rows[0].id
    const secret = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO org_webhook_secrets (id, org_id, platform, secret)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, platform) DO UPDATE SET secret = EXCLUDED.secret, created_at = NOW()`,
      [crypto.randomUUID(), orgId, platform, secret],
    )
    return reply.send({
      ok: true,
      orgKey,
      platform,
      webhookPath: `/api/webhooks/${platform}/${orgKey}`,
      secret,
    })
  })

  /**
   * GET /api/repos/:id/settings — read persisted repo settings (auth required)
   */
  app.get('/api/repos/:id/settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const orgId = activeOrg(req)
    const repoRes = await pool.query(
      isSystemAdmin(req) && !orgId
        ? 'SELECT repo_url, platform FROM repos WHERE repo_id = $1'
        : 'SELECT repo_url, platform FROM repos WHERE repo_id = $1 AND org_id = $2',
      isSystemAdmin(req) && !orgId ? [repoId] : [repoId, orgId],
    )
    if (repoRes.rows.length === 0) return reply.status(404).send({ error: 'Repo not found' })
    const repo = repoRes.rows[0] as { repo_url: string; platform: 'github' | 'azure' }
    const orgIdentityRows = await pool.query<{ slug: string; name: string }>(
      `SELECT o.slug, o.name
       FROM repos r
       JOIN organizations o ON o.id = r.org_id
       WHERE r.repo_id = $1
       LIMIT 1`,
      [repoId],
    )
    const org = orgIdentityRows.rows[0]
      ? { orgKey: orgIdentityRows.rows[0].slug, orgName: orgIdentityRows.rows[0].name }
      : { orgKey: 'default', orgName: 'Default Organization' }
    const orgRows = await pool.query(
      `SELECT
         pr_description_enabled,
         pr_description_update_mode,
         pr_description_publish_mode,
         pr_description_preserve_original,
         pr_description_use_markers,
         pr_description_publish_labels
       FROM org_settings WHERE org_key = $1`,
      [org.orgKey],
    )
    const orgSettings = orgRows.rows[0]
      ? normalizeRepoPRDescriptionSettings(orgRows.rows[0])
      : DEFAULT_REPO_PR_DESCRIPTION_SETTINGS

    const { rows } = await pool.query(
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
    const repoOverrides = rows[0]
      ? {
          enabled: rows[0].pr_description_enabled as boolean | null,
          updateMode: rows[0].pr_description_update_mode as PRDescriptionUpdateMode | null,
          publishMode: rows[0].pr_description_publish_mode as PRDescriptionPublishMode | null,
          preserveOriginal: rows[0].pr_description_preserve_original as boolean | null,
          useMarkers: rows[0].pr_description_use_markers as boolean | null,
          publishLabels: rows[0].pr_description_publish_labels as boolean | null,
        }
      : {}
    const effective = resolveRepoPRDescriptionSettings(orgSettings, repoOverrides)
    return reply.send({ repoId, org: { orgKey: org.orgKey, orgName: org.orgName, platform: repo.platform }, prDescription: { effective, overrides: repoOverrides } })
  })

  /**
   * POST /api/repos/:id/settings — upsert repo settings (auth required)
   */
  app.post('/api/repos/:id/settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const orgId = activeOrg(req)
    const exists = await pool.query(
      isSystemAdmin(req) && !orgId
        ? 'SELECT 1 FROM repos WHERE repo_id = $1'
        : 'SELECT 1 FROM repos WHERE repo_id = $1 AND org_id = $2',
      isSystemAdmin(req) && !orgId ? [repoId] : [repoId, orgId],
    )
    if (exists.rows.length === 0) return reply.status(404).send({ error: 'Repo not found' })
    const body = req.body as {
      prDescription?: Partial<{
        enabled: boolean
        updateMode: PRDescriptionUpdateMode
        publishMode: PRDescriptionPublishMode
        preserveOriginal: boolean
        useMarkers: boolean
        publishLabels: boolean
      }>
    }

    const incoming = body.prDescription ?? {}
    const next = {
      enabled: incoming.enabled ?? null,
      updateMode: incoming.updateMode ?? null,
      publishMode: incoming.publishMode ?? null,
      preserveOriginal: incoming.preserveOriginal ?? null,
      useMarkers: incoming.useMarkers ?? null,
      publishLabels: incoming.publishLabels ?? null,
    }

    if (next.updateMode !== null && next.updateMode !== 'created_only' && next.updateMode !== 'created_and_updated') {
      return reply.status(400).send({ error: 'Invalid updateMode' })
    }
    if (next.publishMode !== null && next.publishMode !== 'replace_pr' && next.publishMode !== 'comment') {
      return reply.status(400).send({ error: 'Invalid publishMode' })
    }

    await pool.query(
      `INSERT INTO repo_settings (
         repo_id,
         pr_description_enabled,
         pr_description_update_mode,
         pr_description_publish_mode,
         pr_description_preserve_original,
         pr_description_use_markers,
         pr_description_publish_labels,
         updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (repo_id) DO UPDATE SET
         pr_description_enabled = EXCLUDED.pr_description_enabled,
         pr_description_update_mode = EXCLUDED.pr_description_update_mode,
         pr_description_publish_mode = EXCLUDED.pr_description_publish_mode,
         pr_description_preserve_original = EXCLUDED.pr_description_preserve_original,
         pr_description_use_markers = EXCLUDED.pr_description_use_markers,
         pr_description_publish_labels = EXCLUDED.pr_description_publish_labels,
         updated_at = NOW()`,
      [
        repoId,
        next.enabled,
        next.updateMode,
        next.publishMode,
        next.preserveOriginal,
        next.useMarkers,
        next.publishLabels,
      ],
    )

    return reply.send({ ok: true, repoId, prDescription: { overrides: next } })
  })

  /**
   * POST /api/repos — register a repo and trigger async full index per branch
   * Body: { repoUrl, platform, token, repoPath, branches? }
   */
  app.post('/api/repos', { preHandler: [requireAuth] }, async (req, reply) => {
    const orgId = activeOrg(req)
    if (!orgId) return reply.status(400).send({ error: 'Active org is required' })
    const { repoUrl, platform, token: rawToken, repoPath, branches, vcsInstallationId,
            githubAppId: rawGithubAppId, githubAppPrivateKey: rawGithubAppPrivateKey, githubAppInstallationId: rawGithubAppInstallationId } = req.body as {
      repoUrl: string
      platform: VcsPlatform
      token?: string
      repoPath?: string
      branches?: string[]
      vcsInstallationId?: string
      githubAppId?: string
      githubAppPrivateKey?: string
      githubAppInstallationId?: string
    }
    let token = rawToken

    if (!repoUrl || !isVcsPlatform(platform)) {
      return reply.status(400).send({ error: 'repoUrl and platform are required' })
    }

    const indexBranches = (branches && branches.length > 0) ? branches : ['main']

    // Derive a stable repoId from the URL
    const repoId = Buffer.from(repoUrl).toString('base64url').slice(0, 32)

    // If connecting via a saved VCS installation, pull credentials from it
    let githubAppId = rawGithubAppId
    let githubAppPrivateKey = rawGithubAppPrivateKey
    let githubAppInstallationId = rawGithubAppInstallationId
    if (vcsInstallationId) {
      const { rows: instRows } = await pool.query(
        `SELECT platform, github_app_id, github_app_private_key, github_app_installation_id
         FROM vcs_installations WHERE id = $1 AND org_id = $2`,
        [vcsInstallationId, orgId],
      )
      if (!instRows[0]) return reply.status(404).send({ error: 'VCS installation not found' })
      if (instRows[0].platform === 'azure') {
        // Azure OAuth installation: token is fetched fresh at review time via vcs_installation_id
        // (OAuth tokens expire; review-runner calls getAzureOAuthToken with the installation ID)
        token = undefined
      } else {
        githubAppId = instRows[0].github_app_id
        githubAppPrivateKey = instRows[0].github_app_private_key
        githubAppInstallationId = instRows[0].github_app_installation_id
      }
    }

    // Ensure repos table exists and upsert the registration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS repos (
        repo_id TEXT PRIMARY KEY,
        repo_url TEXT NOT NULL,
        platform TEXT NOT NULL,
        token TEXT,
        org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        repo_path TEXT,
        indexed_at TIMESTAMPTZ,
        symbol_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await pool.query(`ALTER TABLE repos ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`)
    await pool.query(
      `INSERT INTO repos (repo_id, repo_url, platform, token, repo_path, org_id,
                          github_app_id, github_app_private_key, github_app_installation_id,
                          vcs_installation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (repo_id) DO UPDATE SET
         token = EXCLUDED.token,
         repo_path = EXCLUDED.repo_path,
         github_app_id = EXCLUDED.github_app_id,
         github_app_private_key = EXCLUDED.github_app_private_key,
         github_app_installation_id = EXCLUDED.github_app_installation_id,
         vcs_installation_id = EXCLUDED.vcs_installation_id`,
      [repoId, repoUrl, platform, token ?? null, repoPath ?? null, orgId,
       githubAppId ?? null, githubAppPrivateKey ?? null, githubAppInstallationId ?? null,
       vcsInstallationId ?? null],
    )

    // Ensure repo_branches table exists and insert branch registrations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS repo_branches (
        repo_id TEXT NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
        branch TEXT NOT NULL,
        PRIMARY KEY (repo_id, branch)
      )
    `)
    for (const branch of indexBranches) {
      await pool.query(
        `INSERT INTO repo_branches (repo_id, branch) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [repoId, branch],
      )
    }

    // Trigger full index in background
    setImmediate(() => {
      runFullIndex(pool, repoId, repoPath ?? null, indexBranches, repoUrl, token,
        githubAppId, githubAppPrivateKey, githubAppInstallationId, vcsInstallationId)
    })

    return reply.status(202).send({
      repoId,
      branches: indexBranches,
      message: `Indexing started for ${indexBranches.length} branch(es) — stream progress at /api/repos/${repoId}/index/status?branch=<branch>`,
    })
  })

  /**
   * POST /api/repos/:id/reindex — re-trigger full index for a registered repo (auth required)
   */
  app.post('/api/repos/:id/reindex', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const orgId = activeOrg(req)

    const { rows } = await pool.query(
      isSystemAdmin(req) && !orgId
        ? 'SELECT repo_url, repo_path, token, github_app_id, github_app_private_key, github_app_installation_id, vcs_installation_id FROM repos WHERE repo_id = $1'
        : 'SELECT repo_url, repo_path, token, github_app_id, github_app_private_key, github_app_installation_id, vcs_installation_id FROM repos WHERE repo_id = $1 AND org_id = $2',
      isSystemAdmin(req) && !orgId ? [repoId] : [repoId, orgId],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Repo not found' })
    }

    const { rows: branchRows } = await pool.query(
      'SELECT branch FROM repo_branches WHERE repo_id = $1',
      [repoId],
    )
    const branches = branchRows.length > 0
      ? branchRows.map((r: any) => r.branch)
      : ['main']

    // Reset index status so UI shows "indexing" again
    await pool.query(
      'UPDATE repos SET indexed_at = NULL, symbol_count = 0 WHERE repo_id = $1',
      [repoId],
    )

    setImmediate(() => {
      const r = rows[0] as any
      runFullIndex(pool, repoId, r.repo_path, branches, r.repo_url, r.token, r.github_app_id, r.github_app_private_key, r.github_app_installation_id, r.vcs_installation_id)
    })

    return reply.status(202).send({
      repoId,
      branches,
      message: `Reindex started for ${branches.length} branch(es)`,
    })
  })

  /**
   * GET /api/repos/:id/index/status — SSE stream of indexing progress
   * Query: ?branch=develop  (defaults to 'main')
   */
  app.get('/api/repos/:id/index/status', async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const { branch = 'main' } = req.query as { branch?: string }
    const progressKey = `${repoId}:${branch}`

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders()

    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    // Poll progress every 500ms until done/error or connection closes
    let done = false
    const interval = setInterval(() => {
      const progress = getProgress(progressKey)
      if (progress) {
        send(progress)
        if (progress.step === 'done' || progress.step === 'error') {
          done = true
          clearInterval(interval)
          reply.raw.end()
        }
      }
    }, 500)

    req.raw.on('close', () => {
      clearInterval(interval)
    })

    // Keep connection open (Fastify needs returned promise)
    return new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (done || reply.raw.closed) {
          clearInterval(check)
          resolve()
        }
      }, 100)
    })
  })

  /**
   * GET /api/repos/:id/graph/blast-radius/:symbolId
   * Query: ?branch=develop  (defaults to 'main')
   */
  app.get('/api/repos/:id/graph/blast-radius/:symbolId', async (req, reply) => {
    const { id: repoId, symbolId } = req.params as { id: string; symbolId: string }
    const { branch = 'main' } = req.query as { branch?: string }
    const entry = await getOrLoadRepo(repoId, branch)
    const br = entry.graph.getBlastRadius([decodeURIComponent(symbolId)])
    return reply.send(br)
  })

  /**
   * POST /api/repos/:id/review — manually trigger a review for a PR (auth required)
   * Body: { prNumber, baseBranch? }
   */
  app.post('/api/repos/:id/review', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const orgId = activeOrg(req)
    const { prNumber, baseBranch = 'main', dryRun = false } = req.body as { prNumber: number; baseBranch?: string; dryRun?: boolean }

    if (!prNumber) {
      return reply.status(400).send({ error: 'prNumber is required' })
    }

    const { rows } = await pool.query(
      isSystemAdmin(req) && !orgId
        ? 'SELECT repo_url, platform, token, github_app_id, github_app_private_key, github_app_installation_id FROM repos WHERE repo_id = $1'
        : 'SELECT repo_url, platform, token, github_app_id, github_app_private_key, github_app_installation_id FROM repos WHERE repo_id = $1 AND org_id = $2',
      isSystemAdmin(req) && !orgId ? [repoId] : [repoId, orgId],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Repo not found' })
    }

    const { repo_url: repoUrl, platform, token, github_app_id, github_app_private_key, github_app_installation_id } = rows[0] as any

    // Run review synchronously so the caller gets the result
    try {
      const result = await runReview({
        platform,
        repoId,
        repoUrl,
        prNumber,
        baseBranch,
        token: token ?? undefined,
        githubAppId: github_app_id ?? undefined,
        githubAppPrivateKey: github_app_private_key ?? undefined,
        githubAppInstallationId: github_app_installation_id ?? undefined,
        pool,
        dryRun,
      })

      const { verdict, commentCount, prScore, comments, toolTelemetry } = result as any
      return reply.send({ verdict, commentCount, prScore: prScore ?? null, prNumber, repoId, ...(dryRun ? { dryRun: true, comments, ...(toolTelemetry ? { toolTelemetry } : {}) } : {}) })
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[repos] Manual review failed for PR ${prNumber}:`, msg)
      return reply.status(500).send({ error: msg })
    }
  })

  // ── VCS Installation routes ────────────────────────────────────────────────

  /** GET /api/vcs-installations — list saved installations for the active org */
  app.get('/api/vcs-installations', { preHandler: [requireAuth] }, async (req, reply) => {
    const orgId = activeOrg(req)
    if (!orgId) return reply.status(403).send({ error: 'No active org' })
    const { rows } = await pool.query(
      `SELECT id, platform, display_name, account_login, account_type,
              github_app_id, github_app_installation_id,
              azure_client_id, azure_tenant_id, azure_org_url,
              (azure_access_token IS NOT NULL) AS azure_connected,
              created_at
       FROM vcs_installations WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId],
    )
    return reply.send({ installations: rows })
  })

  /** POST /api/vcs-installations — save a new installation, validate credentials */
  app.post('/api/vcs-installations', { preHandler: [requireAuth] }, async (req, reply) => {
    const orgId = activeOrg(req)
    if (!orgId) return reply.status(403).send({ error: 'No active org' })
    const { platform, displayName, appId, privateKey, installationId, clientId, clientSecret, tenantId, azureOrgUrl, redirectUri } = req.body as {
      platform: string
      displayName?: string
      // GitHub App
      appId?: string
      privateKey?: string
      installationId?: string
      // Azure Entra ID
      clientId?: string
      clientSecret?: string
      tenantId?: string
      azureOrgUrl?: string
      redirectUri?: string
    }
    if (!platform) return reply.status(400).send({ error: 'platform is required' })

    let accountLogin: string | null = null
    let accountType: string | null = null
    let authUrl: string | undefined

    if (platform === 'github') {
      if (!appId || !privateKey || !installationId) {
        return reply.status(400).send({ error: 'appId, privateKey, and installationId are required for GitHub' })
      }
      try {
        const { Octokit } = await import('@octokit/rest')
        const { createAppAuth } = await import('@octokit/auth-app')
        const octokit = new Octokit({
          authStrategy: createAppAuth,
          auth: { appId, privateKey, installationId: Number(installationId) },
        })
        const { data } = await octokit.apps.getInstallation({ installation_id: Number(installationId) })
        accountLogin = (data.account as { login?: string })?.login ?? null
        accountType = (data.account as { type?: string })?.type ?? null
      } catch (err) {
        return reply.status(400).send({ error: `GitHub credentials invalid: ${(err as Error).message}` })
      }
    } else if (platform === 'azure') {
      if (!clientId || !clientSecret || !tenantId || !azureOrgUrl) {
        return reply.status(400).send({ error: 'clientId, clientSecret, tenantId, and azureOrgUrl are required for Azure DevOps' })
      }
      accountLogin = azureOrgUrl.replace(/\/$/, '').split('/').pop() ?? null
      accountType = 'Organization'
    }

    // Generate OAuth state for Azure (used in callback to find this installation)
    const oauthState = platform === 'azure' ? crypto.randomUUID() : null

    const callbackUri = platform === 'azure'
      ? (redirectUri ?? `${process.env.PUBLIC_URL ?? `${req.protocol}://${req.hostname}`}/api/ado/oauth/callback`)
      : null

    const { rows } = await pool.query(
      `INSERT INTO vcs_installations
         (org_id, platform, display_name, account_login, account_type,
          github_app_id, github_app_private_key, github_app_installation_id,
          azure_client_id, azure_client_secret, azure_tenant_id, azure_org_url, azure_oauth_state, azure_redirect_uri)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, platform, display_name, account_login, account_type,
                 github_app_id, github_app_installation_id,
                 azure_client_id, azure_tenant_id, azure_org_url, created_at`,
      [orgId, platform, displayName ?? accountLogin ?? null,
       accountLogin, accountType,
       appId ?? null, privateKey ?? null, installationId ?? null,
       clientId ?? null, clientSecret ?? null, tenantId ?? null, azureOrgUrl ?? null, oauthState, callbackUri],
    )
    const installation = rows[0]

    if (platform === 'azure' && oauthState && clientId && tenantId && callbackUri) {
      authUrl = buildAzureAuthUrl({ clientId, tenantId, redirectUri: callbackUri, state: oauthState })
    }

    return reply.status(201).send({ installation, authUrl })
  })

  /** GET /api/ado/oauth/callback — Microsoft OAuth callback, exchanges code for tokens */
  app.get('/api/ado/oauth/callback', async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string }
    const dashboardBase = process.env.DASHBOARD_URL ?? '/app/connect'

    if (error || !code || !state) {
      return reply.redirect(`${dashboardBase}?azure_error=${encodeURIComponent(error ?? 'missing_params')}`)
    }

    const { rows } = await pool.query(
      `SELECT id, azure_client_id, azure_client_secret, azure_tenant_id, azure_redirect_uri
       FROM vcs_installations WHERE azure_oauth_state = $1`,
      [state],
    )
    if (!rows[0]) return reply.redirect(`${dashboardBase}?azure_error=invalid_state`)
    const inst = rows[0]

    try {
      const redirectUri = inst.azure_redirect_uri
        ?? `${process.env.PUBLIC_URL ?? `${req.protocol}://${req.hostname}`}/api/ado/oauth/callback`
      const tokens = await exchangeAzureCode({
        code, clientId: inst.azure_client_id, clientSecret: inst.azure_client_secret,
        tenantId: inst.azure_tenant_id, redirectUri,
      })
      await pool.query(
        `UPDATE vcs_installations
         SET azure_access_token = $1, azure_refresh_token = $2, azure_token_expires_at = $3, azure_oauth_state = NULL
         WHERE id = $4`,
        [tokens.accessToken, tokens.refreshToken, tokens.expiresAt, inst.id],
      )
      return reply.redirect(`${dashboardBase}?azure_connected=${inst.id}`)
    } catch (err) {
      return reply.redirect(`${dashboardBase}?azure_error=${encodeURIComponent((err as Error).message)}`)
    }
  })

  /** DELETE /api/vcs-installations/:id — remove a saved installation */
  app.delete('/api/vcs-installations/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const orgId = activeOrg(req)
    if (!orgId) return reply.status(403).send({ error: 'No active org' })
    const { id } = req.params as { id: string }
    const { rowCount } = await pool.query(
      'DELETE FROM vcs_installations WHERE id = $1 AND org_id = $2',
      [id, orgId],
    )
    if (!rowCount) return reply.status(404).send({ error: 'Installation not found' })
    return reply.send({ ok: true })
  })

  /** POST /api/vcs-installations/:id/reauth — regenerate Azure OAuth authorization URL */
  app.post('/api/vcs-installations/:id/reauth', { preHandler: [requireAuth] }, async (req, reply) => {
    const orgId = activeOrg(req)
    if (!orgId) return reply.status(403).send({ error: 'No active org' })
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `SELECT platform, azure_client_id, azure_tenant_id
       FROM vcs_installations WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Installation not found' })
    const inst = rows[0]
    if (inst.platform !== 'azure') return reply.status(400).send({ error: 'Re-auth only applies to Azure installations' })
    const { redirectUri: clientRedirectUri } = req.body as { redirectUri?: string }
    const newState = crypto.randomUUID()
    const redirectUri = clientRedirectUri
      ?? `${process.env.PUBLIC_URL ?? `${req.protocol}://${req.hostname}`}/api/ado/oauth/callback`
    await pool.query(
      `UPDATE vcs_installations SET azure_oauth_state = $1, azure_redirect_uri = $2 WHERE id = $3`,
      [newState, redirectUri, id],
    )
    const authUrl = buildAzureAuthUrl({ clientId: inst.azure_client_id, tenantId: inst.azure_tenant_id, redirectUri, state: newState })
    return reply.send({ authUrl })
  })

  /** POST /api/vcs-installations/:id/repos — list repos for a saved installation */
  app.post('/api/vcs-installations/:id/repos', { preHandler: [requireAuth] }, async (req, reply) => {
    const orgId = activeOrg(req)
    if (!orgId) return reply.status(403).send({ error: 'No active org' })
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `SELECT platform, github_app_id, github_app_private_key, github_app_installation_id,
              azure_org_url, azure_client_id, (azure_access_token IS NOT NULL) AS azure_connected
       FROM vcs_installations WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Installation not found' })
    const inst = rows[0]

    if (inst.platform === 'azure') {
      if (!inst.azure_org_url) {
        return reply.status(400).send({ error: 'Azure installation is missing org URL' })
      }
      if (!inst.azure_connected) {
        return reply.status(400).send({ error: 'Azure DevOps not yet authorized. Complete the OAuth flow in the Connect page.' })
      }
      try {
        const accessToken = await getAzureOAuthToken(pool, id)
        const normalizedUrl = inst.azure_org_url.replace(/\/$/, '')
        const res = await fetch(`${normalizedUrl}/_apis/git/repositories?api-version=7.0`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!res.ok) throw new Error(`Azure DevOps API returned ${res.status} ${res.statusText}`)
        const data = await res.json() as { value: Array<{ id: string; name: string; project: { name: string }; remoteUrl: string; isDisabled?: boolean }> }
        const repos = data.value
          .filter(r => !r.isDisabled)
          .map(r => ({
            id: r.id,
            name: r.name,
            fullName: `${r.project.name}/${r.name}`,
            url: r.remoteUrl,
            private: true,
          }))
        const orgName = normalizedUrl.split('/').pop() ?? normalizedUrl
        return reply.send({
          repos,
          installation: {
            accountLogin: orgName,
            accountType: 'Organization',
            repositorySelection: 'all',
          },
        })
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message })
      }
    }

    if (inst.platform === 'github') {
      try {
        const { Octokit } = await import('@octokit/rest')
        const { createAppAuth } = await import('@octokit/auth-app')
        const octokit = new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: inst.github_app_id,
            privateKey: inst.github_app_private_key,
            installationId: Number(inst.github_app_installation_id),
          },
        })
        const [installationRes, allRepos] = await Promise.all([
          octokit.apps.getInstallation({ installation_id: Number(inst.github_app_installation_id) }),
          octokit.paginate(octokit.apps.listReposAccessibleToInstallation, { per_page: 100 }),
        ])
        const installation = installationRes.data
        const repos = allRepos.map((r: { id: number; name: string; full_name: string; html_url: string; private: boolean; description?: string | null }) => ({
          id: r.id,
          name: r.name,
          fullName: r.full_name,
          url: r.html_url,
          private: r.private,
          description: r.description ?? null,
        }))
        return reply.send({
          repos,
          installation: {
            accountLogin: (installation.account as { login?: string })?.login ?? null,
            accountType: (installation.account as { type?: string })?.type ?? null,
            repositorySelection: installation.repository_selection,
          },
        })
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message })
      }
    }

    return reply.status(400).send({ error: `Repo listing not yet supported for platform: ${inst.platform}` })
  })

  /**
   * POST /api/github-app/repos — list repos accessible to a GitHub App installation (auth required)
   * Body: { appId, privateKey, installationId }
   * Returns up to 100 repos the installation has access to.
   */
  app.post('/api/github-app/repos', { preHandler: [requireAuth] }, async (req, reply) => {
    const { appId, privateKey, installationId } = req.body as {
      appId: string
      privateKey: string
      installationId: string
    }
    if (!appId || !privateKey || !installationId) {
      return reply.status(400).send({ error: 'appId, privateKey, and installationId are required' })
    }
    try {
      const { Octokit } = await import('@octokit/rest')
      const { createAppAuth } = await import('@octokit/auth-app')
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: { appId, privateKey, installationId: Number(installationId) },
      })
      // Fetch installation info and all repos (paginated) in parallel
      const [installationRes, allRepos] = await Promise.all([
        octokit.apps.getInstallation({ installation_id: Number(installationId) }),
        octokit.paginate(octokit.apps.listReposAccessibleToInstallation, { per_page: 100 }),
      ])
      const installation = installationRes.data
      const repos = allRepos.map((r: any) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        private: r.private,
        description: r.description ?? null,
      }))
      return reply.send({
        repos,
        installation: {
          accountLogin: (installation.account as any)?.login ?? null,
          accountType: (installation.account as any)?.type ?? null,
          repositorySelection: installation.repository_selection,
        },
      })
    } catch (err: any) {
      const msg = err?.message ?? 'Failed to list repositories'
      return reply.status(400).send({ error: msg })
    }
  })

  /**
   * POST /api/repos/:id/github-app — add or update GitHub App credentials on an existing repo (auth required)
   * Body: { appId, privateKey, installationId }
   */
  app.post('/api/repos/:id/github-app', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const orgId = activeOrg(req)
    const exists = await pool.query(
      isSystemAdmin(req) && !orgId
        ? 'SELECT 1 FROM repos WHERE repo_id = $1'
        : 'SELECT 1 FROM repos WHERE repo_id = $1 AND org_id = $2',
      isSystemAdmin(req) && !orgId ? [repoId] : [repoId, orgId],
    )
    if (exists.rows.length === 0) return reply.status(404).send({ error: 'Repo not found' })

    const { appId, privateKey, installationId } = req.body as {
      appId: string
      privateKey: string
      installationId: string
    }
    if (!appId || !privateKey || !installationId) {
      return reply.status(400).send({ error: 'appId, privateKey, and installationId are required' })
    }

    await pool.query(
      `UPDATE repos SET github_app_id = $1, github_app_private_key = $2, github_app_installation_id = $3 WHERE repo_id = $4`,
      [appId, privateKey, installationId, repoId],
    )

    return reply.send({ ok: true, repoId, githubAppId: appId, githubAppInstallationId: installationId })
  })

  /**
   * DELETE /api/repos/:id — evict all branches from cache and remove from DB
   */
  app.delete('/api/repos/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const orgId = activeOrg(req)
    await pool.query(
      isSystemAdmin(req) && !orgId
        ? 'DELETE FROM repos WHERE repo_id = $1'
        : 'DELETE FROM repos WHERE repo_id = $1 AND org_id = $2',
      isSystemAdmin(req) && !orgId ? [repoId] : [repoId, orgId],
    )
    evictRepo(repoId) // evicts all branches (no branch arg = evict all)
    return reply.status(204).send()
  })

  /**
   * GET /api/repos/:id/feedback-metrics — weekly accepted/rejected feedback counts (auth required)
   */
  app.get('/api/repos/:id/feedback-metrics', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const orgId = activeOrg(req)
    const canAccess = await pool.query(
      isSystemAdmin(req) && !orgId
        ? 'SELECT 1 FROM repos WHERE repo_id = $1'
        : 'SELECT 1 FROM repos WHERE repo_id = $1 AND org_id = $2',
      isSystemAdmin(req) && !orgId ? [repoId] : [repoId, orgId],
    )
    if (canAccess.rows.length === 0) return reply.status(404).send({ error: 'Repo not found' })

    const { rows } = await pool.query(
      `SELECT
         DATE_TRUNC('week', rf.created_at)::date AS date,
         COUNT(CASE WHEN rf.signal = 'accepted' THEN 1 END)::int AS accepted,
         COUNT(CASE WHEN rf.signal = 'rejected' THEN 1 END)::int AS rejected
       FROM review_feedback rf
       JOIN review_comments rc ON rc.id = rf.comment_id
       WHERE rc.repo_id = $1
       GROUP BY DATE_TRUNC('week', rf.created_at)
       ORDER BY date ASC`,
      [repoId],
    )

    const totals = rows.reduce(
      (acc: any, r: any) => ({ accepted: acc.accepted + r.accepted, rejected: acc.rejected + r.rejected }),
      { accepted: 0, rejected: 0 },
    )
    const total = totals.accepted + totals.rejected

    return reply.send({
      repoId,
      series: rows.map((r: any) => ({ date: r.date, accepted: r.accepted, rejected: r.rejected })),
      totals: { ...totals, total, acceptanceRate: total > 0 ? +(totals.accepted / total).toFixed(2) : null },
    })
  })

  /**
   * GET /api/repos/:id/reviews — repo-scoped recent reviews (auth required)
   */
  app.get('/api/repos/:id/reviews', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const repo = await getAccessibleRepo(req, repoId)
    if (!repo) return reply.status(404).send({ error: 'Repo not found' })

    const { rows } = await pool.query(
      `SELECT r.id, r.pr_number, r.verdict, r.comment_count, r.created_at,
              COALESCE(f.accepted, 0)::int AS accepted,
              COALESCE(f.rejected, 0)::int AS rejected
       FROM reviews r
       LEFT JOIN (
         SELECT rc.review_id,
                COUNT(*) FILTER (WHERE rf.signal = 'accepted') AS accepted,
                COUNT(*) FILTER (WHERE rf.signal = 'rejected') AS rejected
         FROM review_comments rc
         LEFT JOIN review_feedback rf ON rf.comment_id = rc.id
         GROUP BY rc.review_id
       ) f ON f.review_id = r.id
       WHERE r.repo_id = $1
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [repoId],
    )

    return reply.send(rows.map((r: any) => ({
      id: r.id,
      prNumber: r.pr_number,
      verdict: r.verdict,
      commentCount: r.comment_count,
      accepted: r.accepted,
      rejected: r.rejected,
      createdAt: r.created_at,
    })))
  })

  /**
   * GET /api/repos/:id/agent-telemetry — per-agent stats (auth required)
   */
  app.get('/api/repos/:id/agent-telemetry', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const { days = '30' } = req.query as { days?: string }
    const daysNum = Number.parseInt(days, 10)
    const boundedDays = Number.isFinite(daysNum) && daysNum > 0 ? Math.min(daysNum, 365) : 30
    const repo = await getAccessibleRepo(req, repoId)
    if (!repo) return reply.status(404).send({ error: 'Repo not found' })

    const totals = await pool.query(
      `SELECT agent_role,
              COUNT(*)::int AS runs,
              ROUND(AVG(duration_ms))::int AS avg_duration_ms,
              SUM(comment_count)::int AS total_comments,
              COUNT(*) FILTER (WHERE verdict = 'request_changes')::int AS request_changes_count,
              COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS error_count,
              SUM(tokens_used)::bigint AS total_tokens
       FROM review_agent_telemetry
       WHERE repo_id = $1
         AND created_at >= NOW() - ($2::text || ' days')::interval
       GROUP BY agent_role
       ORDER BY runs DESC, agent_role ASC`,
      [repoId, String(boundedDays)],
    )
    const trend = await pool.query(
      `SELECT DATE_TRUNC('day', created_at)::date AS day,
              agent_role,
              COUNT(*)::int AS runs
       FROM review_agent_telemetry
       WHERE repo_id = $1
         AND created_at >= NOW() - ($2::text || ' days')::interval
       GROUP BY DATE_TRUNC('day', created_at), agent_role
       ORDER BY day ASC, agent_role ASC`,
      [repoId, String(boundedDays)],
    )

    return reply.send({
      repoId,
      days: boundedDays,
      agents: totals.rows.map((r: any) => ({
        role: r.agent_role,
        runs: r.runs,
        avgDurationMs: r.avg_duration_ms ?? 0,
        totalComments: r.total_comments ?? 0,
        requestChangesCount: r.request_changes_count ?? 0,
        errorCount: r.error_count ?? 0,
        totalTokens: r.total_tokens != null ? Number(r.total_tokens) : null,
      })),
      trend: trend.rows.map((r: any) => ({
        date: r.day,
        role: r.agent_role,
        runs: r.runs,
      })),
    })
  })

  /**
   * GET /api/orgs/:orgKey/token-usage — org-wide token usage by date range (auth required)
   */
  app.get('/api/orgs/:orgKey/token-usage', { preHandler: [requireAuth] }, async (req, reply) => {
    const { orgKey } = req.params as { orgKey: string }
    const { from, to } = req.query as { from?: string; to?: string }

    const orgRes = await pool.query<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [orgKey])
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'org not found' })
    const orgId = orgRes.rows[0].id

    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const toDate = to ? new Date(to) : new Date()
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return reply.status(400).send({ error: 'invalid date range' })
    }

    // Per-agent breakdown
    const byAgent = await pool.query(
      `SELECT agent_role,
              COUNT(*)::int AS runs,
              COALESCE(SUM(tokens_used), 0)::bigint AS total_tokens,
              ROUND(AVG(tokens_used))::int AS avg_tokens
       FROM review_agent_telemetry
       WHERE org_id = $1
         AND created_at >= $2
         AND created_at <= $3
       GROUP BY agent_role
       ORDER BY total_tokens DESC`,
      [orgId, fromDate.toISOString(), toDate.toISOString()],
    )

    // Per-repo breakdown
    const byRepo = await pool.query(
      `SELECT rat.repo_id, r.repo_url,
              COUNT(*)::int AS runs,
              COALESCE(SUM(rat.tokens_used), 0)::bigint AS total_tokens
       FROM review_agent_telemetry rat
       LEFT JOIN repos r ON r.repo_id = rat.repo_id
       WHERE rat.org_id = $1
         AND rat.created_at >= $2
         AND rat.created_at <= $3
       GROUP BY rat.repo_id, r.repo_url
       ORDER BY total_tokens DESC`,
      [orgId, fromDate.toISOString(), toDate.toISOString()],
    )

    // Daily totals
    const daily = await pool.query(
      `SELECT DATE_TRUNC('day', created_at)::date AS day,
              COALESCE(SUM(tokens_used), 0)::bigint AS total_tokens,
              COUNT(*)::int AS runs
       FROM review_agent_telemetry
       WHERE org_id = $1
         AND created_at >= $2
         AND created_at <= $3
       GROUP BY DATE_TRUNC('day', created_at)
       ORDER BY day ASC`,
      [orgId, fromDate.toISOString(), toDate.toISOString()],
    )

    const grandTotal = byAgent.rows.reduce((sum: number, r: any) => sum + Number(r.total_tokens), 0)

    return reply.send({
      orgKey,
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      totalTokens: grandTotal,
      byAgent: byAgent.rows.map((r: any) => ({
        role: r.agent_role,
        runs: r.runs,
        totalTokens: Number(r.total_tokens),
        avgTokens: r.avg_tokens ?? 0,
      })),
      byRepo: byRepo.rows.map((r: any) => ({
        repoId: r.repo_id,
        repoUrl: r.repo_url ?? r.repo_id,
        runs: r.runs,
        totalTokens: Number(r.total_tokens),
      })),
      daily: daily.rows.map((r: any) => ({
        date: r.day,
        totalTokens: Number(r.total_tokens),
        runs: r.runs,
      })),
    })
  })

  /**
   * GET /api/repos/:id/analytics — consolidated repo analytics for dashboard detail page (auth required)
   */
  app.get('/api/repos/:id/analytics', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    const repo = await getAccessibleRepo(req, repoId)
    if (!repo) return reply.status(404).send({ error: 'Repo not found' })

    const reviewTotals = await pool.query<{ total: string; last_30_days: string; avg_comments: string; request_changes: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::text AS last_30_days,
         COALESCE(AVG(comment_count), 0)::text AS avg_comments,
         COUNT(*) FILTER (WHERE verdict = 'request_changes')::text AS request_changes
       FROM reviews
       WHERE repo_id = $1`,
      [repoId],
    )
    const feedbackTotals = await pool.query<{ accepted: string; rejected: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE rf.signal = 'accepted')::text AS accepted,
         COUNT(*) FILTER (WHERE rf.signal = 'rejected')::text AS rejected
       FROM review_feedback rf
       JOIN review_comments rc ON rc.id = rf.comment_id
       WHERE rc.repo_id = $1`,
      [repoId],
    )
    const rulesTotals = await pool.query<{ evaluations: string; violations: string; merged: string; passed: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM rule_evaluations WHERE repo_id = $1) AS evaluations,
         (SELECT COUNT(*)::text FROM rule_violations WHERE repo_id = $1) AS violations,
         (SELECT COUNT(*)::text FROM rule_violations WHERE repo_id = $1 AND status = 'merged_with_violation') AS merged,
         (SELECT COUNT(*)::text FROM rule_evaluations WHERE repo_id = $1 AND passed = true) AS passed`,
      [repoId],
    )
    const agentTotals = await pool.query<{ runs: string; avg_duration_ms: string; errors: string }>(
      `SELECT
         COUNT(*)::text AS runs,
         COALESCE(ROUND(AVG(duration_ms)), 0)::text AS avg_duration_ms,
         COUNT(*) FILTER (WHERE error IS NOT NULL)::text AS errors
       FROM review_agent_telemetry
       WHERE repo_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [repoId],
    )

    const accepted = parseInt(feedbackTotals.rows[0]?.accepted ?? '0', 10)
    const rejected = parseInt(feedbackTotals.rows[0]?.rejected ?? '0', 10)
    const feedbackTotal = accepted + rejected
    const reviewsTotal = parseInt(reviewTotals.rows[0]?.total ?? '0', 10)
    const requestChanges = parseInt(reviewTotals.rows[0]?.request_changes ?? '0', 10)
    const ruleEvaluations = parseInt(rulesTotals.rows[0]?.evaluations ?? '0', 10)
    const rulePassed = parseInt(rulesTotals.rows[0]?.passed ?? '0', 10)

    return reply.send({
      repo: {
        repoId: repo.repo_id,
        repoUrl: repo.repo_url,
        platform: repo.platform,
        indexedAt: repo.indexed_at,
        symbolCount: repo.symbol_count ?? 0,
        createdAt: repo.created_at,
      },
      reviews: {
        total: reviewsTotal,
        last30Days: parseInt(reviewTotals.rows[0]?.last_30_days ?? '0', 10),
        avgComments: +Number(reviewTotals.rows[0]?.avg_comments ?? '0').toFixed(2),
        requestChanges,
        requestChangesRate: reviewsTotal > 0 ? +(requestChanges / reviewsTotal).toFixed(4) : 0,
      },
      feedback: {
        accepted,
        rejected,
        total: feedbackTotal,
        acceptanceRate: feedbackTotal > 0 ? +(accepted / feedbackTotal).toFixed(4) : 0,
      },
      rules: {
        evaluations: ruleEvaluations,
        violations: parseInt(rulesTotals.rows[0]?.violations ?? '0', 10),
        mergedViolations: parseInt(rulesTotals.rows[0]?.merged ?? '0', 10),
        passRate: ruleEvaluations > 0 ? +(rulePassed / ruleEvaluations).toFixed(4) : 0,
      },
      agents: {
        runs30Days: parseInt(agentTotals.rows[0]?.runs ?? '0', 10),
        avgDurationMs30Days: parseInt(agentTotals.rows[0]?.avg_duration_ms ?? '0', 10),
        errors30Days: parseInt(agentTotals.rows[0]?.errors ?? '0', 10),
      },
    })
  })
}

// ----- Background full-index runner (shared by POST /repos and POST /repos/:id/reindex) -----
async function runFullIndex(
  pool: Pool,
  repoId: string,
  repoPath: string | null,
  indexBranches: string[],
  repoUrl?: string,
  token?: string | null,
  githubAppId?: string | null,
  githubAppPrivateKey?: string | null,
  githubAppInstallationId?: string | null,
  vcsInstallationId?: string | null,
): Promise<void> {
  let resolvedPath = repoPath

  // Determine clone directory: use stored path or derive from REPOS_DIR
  const cloneDir = resolvedPath || `${REPOS_DIR}/${repoId}`

  if (!repoUrl && !resolvedPath) {
    const errMsg = 'Cannot index: repoUrl is required for auto-cloning'
    for (const branch of indexBranches) setProgress(`${repoId}:${branch}`, { step: 'error', message: errMsg })
    return
  }

  try {
    mkdirSync(REPOS_DIR, { recursive: true })
  } catch { /* already exists */ }

  for (const branch of indexBranches) {
    setProgress(`${repoId}:${branch}`, { step: 'parsing', progress: 0, total: 0, file: `Cloning ${repoUrl}...` })
  }

  try {
    // Always generate a fresh token — GitHub App installation tokens expire after 1 hour
    // For Azure OAuth installations, fetch a fresh Bearer token via the stored installation
    let cloneToken = token
    if (!cloneToken && !githubAppId && vcsInstallationId) {
      try {
        const { getAzureOAuthToken } = await import('../azure-oauth')
        cloneToken = await getAzureOAuthToken(pool, vcsInstallationId)
      } catch (err) {
        console.error('[repos] Failed to get Azure OAuth token for clone:', (err as Error).message)
      }
    }
    const freshToken = await resolveCloneToken(githubAppId, githubAppPrivateKey, githubAppInstallationId, cloneToken)
    if (!existsSync(cloneDir)) {
      const cloneUrl = buildAuthenticatedUrl(repoUrl!, freshToken)
      // Clone the first indexed branch explicitly so the refspec tracks the right branch
      const primaryBranch = indexBranches[0] ?? 'main'
      console.log(`[repos] Auto-cloning ${repoUrl} (branch: ${primaryBranch}) → ${cloneDir}`)
      await execAsync(`git clone --depth=1 -b "${primaryBranch}" "${cloneUrl}" "${cloneDir}"`, { timeout: 300_000 })
    } else {
      // Pull latest — update remote URL with a fresh token before fetching
      console.log(`[repos] Pulling latest in ${cloneDir}`)
      if (freshToken && repoUrl) {
        const freshUrl = buildAuthenticatedUrl(repoUrl, freshToken)
        await execAsync(`git -C "${cloneDir}" remote set-url origin "${freshUrl}"`, { timeout: 10_000 })
      }
      // Fetch the primary branch and reset to FETCH_HEAD.
      // Note: shallow fetches don't create refs/remotes/origin/BRANCH, only FETCH_HEAD.
      const primaryBranch = indexBranches[0]
      await execAsync(`git -C "${cloneDir}" fetch --depth=1 origin "${primaryBranch}" && git -C "${cloneDir}" reset --hard FETCH_HEAD`, { timeout: 120_000 })
    }
  } catch (err) {
    const execErr = err as ExecException & { stderr?: string }
    const detail = execErr.stderr?.trim() || execErr.message.split('\n').slice(1).join(' ').trim()
    const errMsg = `Clone/pull failed: ${detail || execErr.message.split('\n')[0]}`
    console.error(`[repos] ${errMsg}`)
    for (const branch of indexBranches) setProgress(`${repoId}:${branch}`, { step: 'error', message: errMsg })
    return
  }

  resolvedPath = cloneDir
  // Persist the resolved path so reindex can reuse it
  await pool.query('UPDATE repos SET repo_path = $1 WHERE repo_id = $2', [resolvedPath, repoId])

  if (!existsSync(resolvedPath)) {
    const errMsg = `repoPath does not exist: ${resolvedPath}`
    console.error(`[repos] ${errMsg}`)
    for (const branch of indexBranches) setProgress(`${repoId}:${branch}`, { step: 'error', message: errMsg })
    return
  }

  try {
    const embeddingAdapter = createEmbeddingAdapter(pool)
    const storage = new PostgresStorageAdapter(pool)
    await storage.migrate(embeddingAdapter?.dim ?? 1024)

    let totalSymbols = 0

    await Promise.all(indexBranches.map(async (branch) => {
      const graph = new InMemorySymbolGraph()
      const registry = await createDefaultRegistry()
      const indexer = new Indexer(registry, graph, storage, embeddingAdapter)

      const stats = await indexer.fullIndex(resolvedPath!, repoId, branch, (progress) => {
        setProgress(`${repoId}:${branch}`, progress)
      })

      totalSymbols += stats.symbolCount
      await loadRepo(repoId, branch)
    }))

    // Mark repo as indexed in DB
    await pool.query(
      'UPDATE repos SET indexed_at = NOW(), symbol_count = $1 WHERE repo_id = $2',
      [totalSymbols, repoId],
    )
  } catch (err) {
    console.error(`[repos] Full index failed for ${repoId}:`, (err as Error).message)
  }
}


// ----- Simple in-process progress store -----
// Key format: `${repoId}:${branch}`
const progressStore = new Map<string, IndexProgress | null>()

function setProgress(key: string, progress: IndexProgress | null): void {
  progressStore.set(key, progress)
}

function getProgress(key: string): IndexProgress | null | undefined {
  return progressStore.get(key)
}
