import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import fastifyCookie from '@fastify/cookie'
import fastifyJwt from '@fastify/jwt'
import fastifyRateLimit from '@fastify/rate-limit'
import crypto from 'crypto'
import path from 'path'
import { Pool } from 'pg'
import type { FastifyRequest } from 'fastify'
import { webhookRoutes } from './routes/webhooks'
import { repoRoutes } from './routes/repos'
import { rulesRoutes } from './routes/rules'
import { authRoutes } from './routes/auth'
import { feedbackRoutes } from './routes/feedback'
import { initGraphCache, warmupAllRepos } from './graph-cache'
import { seedAdminUser } from './auth/seed'
import { requireAuth } from './auth/middleware'
import type { AuthJwtClaims } from './auth/types'

// Extend FastifyInstance with db
declare module 'fastify' {
  interface FastifyInstance {
    db: Pool
    rawBody?: Buffer
  }
  interface FastifyRequest {
    rawBody?: Buffer
  }
}

async function buildServer() {
  const trustProxy = (process.env.TRUST_PROXY ?? 'true').toLowerCase() !== 'false'
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024, trustProxy })
  const rateLimitEnabled = (process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false'
  const globalMaxRaw = parseInt(process.env.RATE_LIMIT_GLOBAL_MAX ?? '300', 10)
  const globalMax = Number.isFinite(globalMaxRaw) && globalMaxRaw > 0 ? globalMaxRaw : 300
  const globalWindow = process.env.RATE_LIMIT_GLOBAL_WINDOW ?? '1 minute'

  await app.register(sensible)
  await app.register(fastifyCookie)
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? 'changeme',
    cookie: { cookieName: 'agnus_session', signed: false },
  })
  if (rateLimitEnabled) {
    await app.register(fastifyRateLimit, {
      global: true,
      max: globalMax,
      timeWindow: globalWindow,
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
      keyGenerator: (req: FastifyRequest) => req.ip,
      errorResponseBuilder: (_req: FastifyRequest, context: { max: number; after: string }) => ({
        statusCode: 429,
        code: 'FST_ERR_RATE_LIMIT',
        error: 'Too many requests',
        message: `Rate limit exceeded, retry in ${context.after}`,
        limit: context.max,
        timeWindow: context.after,
      }),
    })
  }

  // Raw body support for webhook signature verification
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer
    try {
      done(null, JSON.parse((body as Buffer).toString()))
    } catch (err) {
      done(err as Error)
    }
  })

  // Postgres connection pool
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  app.decorate('db', pool)


  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // Routes
  const rulesSystemEnabled = (process.env.RULES_SYSTEM_ENABLED ?? 'true').toLowerCase() !== 'false'
  await app.register(authRoutes)
  await app.register(webhookRoutes)
  await app.register(repoRoutes)
  if (rulesSystemEnabled) await app.register(rulesRoutes)
  await app.register(feedbackRoutes)

  // GET /api/repos/:id/precision — per-confidence-bucket acceptance rates (auth required)
  app.get('/api/repos/:id/precision', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = req.user as AuthJwtClaims
    const orgId = user?.activeOrgId ?? null
    const canAccess = await app.db.query(
      user?.isSystemAdmin && !orgId
        ? 'SELECT 1 FROM repos WHERE repo_id = $1'
        : 'SELECT 1 FROM repos WHERE repo_id = $1 AND org_id = $2',
      user?.isSystemAdmin && !orgId ? [id] : [id, orgId],
    )
    if (canAccess.rows.length === 0) return reply.status(404).send({ error: 'Repo not found' })
    const { rows } = await app.db.query(
      `SELECT
         CASE
           WHEN rc.confidence >= 0.9 THEN '0.9-1.0'
           WHEN rc.confidence >= 0.8 THEN '0.8-0.9'
           WHEN rc.confidence >= 0.7 THEN '0.7-0.8'
           WHEN rc.confidence >= 0.5 THEN '0.5-0.7'
           ELSE 'unknown'
         END AS bucket,
         COUNT(*)::int AS total,
         COUNT(rf.id) FILTER (WHERE rf.signal = 'accepted')::int AS accepted
       FROM review_comments rc
       LEFT JOIN review_feedback rf ON rf.comment_id = rc.id
       WHERE rc.repo_id = $1
       GROUP BY bucket
       ORDER BY bucket DESC`,
      [id],
    )
    const buckets = rows.map((r: any) => ({
      bucket: r.bucket,
      total: r.total,
      accepted: r.accepted,
      acceptanceRate: r.total > 0 ? Math.round((r.accepted / r.total) * 100) : null,
    }))
    return reply.send({ buckets })
  })

  // GET /api/reviews — return last 50 reviews (auth required)
  app.get('/api/reviews', { preHandler: [requireAuth] }, async (_req, reply) => {
    const reqAny = _req as FastifyRequest & { user: AuthJwtClaims }
    const orgId = reqAny.user?.activeOrgId ?? null
    const isSystem = Boolean(reqAny.user?.isSystemAdmin) && !orgId
    const { rows } = await app.db.query(isSystem ? `
      SELECT r.id, r.repo_id, r.pr_number, r.verdict, r.comment_count, r.created_at,
             repos.repo_url
      FROM reviews r
      LEFT JOIN repos ON repos.repo_id = r.repo_id
      ORDER BY r.created_at DESC LIMIT 50
    ` : `
      SELECT r.id, r.repo_id, r.pr_number, r.verdict, r.comment_count, r.created_at,
             repos.repo_url
      FROM reviews r
      LEFT JOIN repos ON repos.repo_id = r.repo_id
      WHERE repos.org_id = $1
      ORDER BY r.created_at DESC LIMIT 50
    `, isSystem ? [] : [orgId])
    return reply.send(rows.map((r: any) => ({
      id: r.id,
      repoId: r.repo_id,
      repoUrl: r.repo_url ?? '',
      prNumber: r.pr_number,
      verdict: r.verdict,
      commentCount: r.comment_count,
      createdAt: r.created_at,
    })))
  })

  // GET /api/settings — read per-user settings (auth required)
  app.get('/api/settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as { id: string }
    const { rows } = await app.db.query(
      'SELECT review_depth FROM user_settings WHERE user_id = $1',
      [user.id],
    )
    return reply.send({ reviewDepth: rows[0]?.review_depth ?? 'standard' })
  })

  // POST /api/settings — upsert per-user settings (auth required)
  app.post('/api/settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as { id: string }
    const { reviewDepth } = req.body as { reviewDepth?: string }
    const depth = reviewDepth ?? 'standard'
    await app.db.query(
      `INSERT INTO user_settings (user_id, review_depth) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET review_depth = EXCLUDED.review_depth`,
      [user.id, depth],
    )
    return reply.send({ ok: true })
  })

  // Serve VitePress docs at /docs
  const docsDist = process.env.DOCS_DIST ??
    path.join(__dirname, '../../docs/.vitepress/dist')
  const fs = await import('fs')
  if (fs.existsSync(docsDist)) {
    app.get('/docs', async (_req, reply) => reply.redirect(301, '/docs/'))

    const fastifyStatic = await import('@fastify/static')
    await app.register(fastifyStatic.default, {
      root: docsDist,
      prefix: '/docs/',
      decorateReply: false,
      extensions: ['html'],
    })
    app.log.info(`Docs served at /docs/ from ${docsDist}`)
  } else {
    app.log.warn(`Docs not found at ${docsDist} — build with: pnpm --filter @agnus-ai/docs build`)
  }

  // Serve dashboard SPA at /* (registered last — API and docs routes take priority)
  const dashboardDist = process.env.DASHBOARD_DIST ??
    path.join(__dirname, '../../dashboard/dist')
  const fsDash = await import('fs')
  if (fsDash.existsSync(dashboardDist)) {
    const fastifyStatic = await import('@fastify/static')
    await app.register(fastifyStatic.default, {
      root: dashboardDist,
      prefix: '/',
      decorateReply: true,
      wildcard: false,
    })
    // SPA catch-all: serves index.html for any path not matched by a static file
    app.get('/*', async (req, reply) => {
      const reqPath = (req.params as any)['*'] as string ?? ''
      if (reqPath) {
        const filePath = path.join(dashboardDist, reqPath)
        if (fsDash.existsSync(filePath) && fsDash.statSync(filePath).isFile()) {
          return reply.sendFile(reqPath)
        }
      }
      return reply.sendFile('index.html')
    })
    app.log.info(`SPA served at / from ${dashboardDist}`)
  } else {
    app.log.warn(`Dashboard not found at ${dashboardDist} — run: pnpm --filter @agnus-ai/dashboard build`)
  }

  return app
}

async function main() {
  const app = await buildServer()

  // Initialize graph cache and warm up known repos
  const pool: Pool = app.db
  const depth = (process.env.REVIEW_DEPTH as any) ?? 'standard'
  initGraphCache(pool, depth)

  // Run schema migrations (idempotent — safe to run every startup)
  const { PostgresStorageAdapter } = await import('@agnus-ai/core')
  const { createEmbeddingAdapter } = await import('./embedding-factory')
  const embeddingForMigration = createEmbeddingAdapter(pool)
  const storageForMigration = new PostgresStorageAdapter(pool)
  await storageForMigration.migrate(embeddingForMigration?.dim ?? 1024)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repos (
      repo_id TEXT PRIMARY KEY,
      repo_url TEXT NOT NULL,
      platform TEXT NOT NULL,
      token TEXT,
      repo_path TEXT,
      indexed_at TIMESTAMPTZ,
      symbol_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE repos ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE repos ADD COLUMN IF NOT EXISTS symbol_count INT DEFAULT 0`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      is_system_admin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system_admin BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, user_id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS org_webhook_secrets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      secret TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, platform)
    )
  `)
  await pool.query(`ALTER TABLE repos ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_repos_org ON repos(org_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      email TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      org_role TEXT NOT NULL DEFAULT 'member',
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE invites ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`)
  await pool.query(`ALTER TABLE invites ADD COLUMN IF NOT EXISTS org_role TEXT NOT NULL DEFAULT 'member'`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
      pr_number INT NOT NULL,
      verdict TEXT,
      comment_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_comments (
      id          TEXT PRIMARY KEY,
      review_id   TEXT REFERENCES reviews(id) ON DELETE CASCADE,
      repo_id     TEXT NOT NULL,
      pr_number   INT  NOT NULL,
      path        TEXT,
      line        INT,
      body        TEXT,
      severity    TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_feedback (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      comment_id  TEXT NOT NULL REFERENCES review_comments(id) ON DELETE CASCADE,
      signal      TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(comment_id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_agent_telemetry (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      repo_id TEXT NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
      pr_number INT NOT NULL,
      agent_role TEXT NOT NULL,
      verdict TEXT NOT NULL,
      comment_count INT NOT NULL DEFAULT 0,
      duration_ms INT NOT NULL DEFAULT 0,
      tokens_used INT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE review_agent_telemetry ADD COLUMN IF NOT EXISTS tokens_used INT`)
  await pool.query(`ALTER TABLE review_agent_telemetry ADD COLUMN IF NOT EXISTS error TEXT`)
  await pool.query(`ALTER TABLE review_agent_telemetry ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_agent_telemetry_repo_date ON review_agent_telemetry(repo_id, created_at DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_agent_telemetry_org_date ON review_agent_telemetry(org_id, created_at DESC)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      review_depth TEXT NOT NULL DEFAULT 'standard'
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      examples TEXT,
      category TEXT NOT NULL DEFAULT 'custom',
      severity TEXT NOT NULL DEFAULT 'warning',
      enabled BOOLEAN NOT NULL DEFAULT true,
      scope_type TEXT NOT NULL DEFAULT 'org',
      repo_id TEXT REFERENCES repos(repo_id) ON DELETE CASCADE,
      path_pattern TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS examples TEXT`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'custom'`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'warning'`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'org'`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS repo_id TEXT REFERENCES repos(repo_id) ON DELETE CASCADE`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS path_pattern TEXT`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id) ON DELETE SET NULL`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rules_org ON rules(org_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rules_repo ON rules(repo_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(org_id, enabled)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rule_suggestions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      examples TEXT,
      category TEXT NOT NULL DEFAULT 'custom',
      severity TEXT NOT NULL DEFAULT 'warning',
      suggested_scope_type TEXT NOT NULL DEFAULT 'org',
      suggested_repo_id TEXT REFERENCES repos(repo_id) ON DELETE CASCADE,
      suggested_path_pattern TEXT,
      evidence TEXT,
      source_count INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS examples TEXT`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'custom'`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'warning'`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS suggested_scope_type TEXT NOT NULL DEFAULT 'org'`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS suggested_repo_id TEXT REFERENCES repos(repo_id) ON DELETE CASCADE`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS suggested_path_pattern TEXT`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS evidence TEXT`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS source_count INT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`ALTER TABLE rule_suggestions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rule_suggestions_org_status ON rule_suggestions(org_id, status)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rule_violations (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      repo_id TEXT NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
      review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,
      pr_number INT NOT NULL,
      file_path TEXT,
      line_number INT,
      comment_body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `)
  await pool.query(`ALTER TABLE rule_violations ADD COLUMN IF NOT EXISTS review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL`)
  await pool.query(`ALTER TABLE rule_violations ADD COLUMN IF NOT EXISTS file_path TEXT`)
  await pool.query(`ALTER TABLE rule_violations ADD COLUMN IF NOT EXISTS line_number INT`)
  await pool.query(`ALTER TABLE rule_violations ADD COLUMN IF NOT EXISTS comment_body TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE rule_violations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'`)
  await pool.query(`ALTER TABLE rule_violations ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`ALTER TABLE rule_violations ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rule_violations_org_detected ON rule_violations(org_id, detected_at DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rule_violations_rule ON rule_violations(rule_id, detected_at DESC)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rule_evaluations (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      repo_id TEXT NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
      review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,
      pr_number INT NOT NULL,
      passed BOOLEAN NOT NULL,
      evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (rule_id, repo_id, pr_number, review_id)
    )
  `)
  await pool.query(`ALTER TABLE rule_evaluations ADD COLUMN IF NOT EXISTS review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rule_evaluations_org_date ON rule_evaluations(org_id, evaluated_at DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rule_evaluations_rule_date ON rule_evaluations(rule_id, evaluated_at DESC)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS org_settings (
      org_key TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      org_name TEXT NOT NULL,
      pr_description_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      pr_description_update_mode TEXT NOT NULL DEFAULT 'created_only',
      pr_description_publish_mode TEXT NOT NULL DEFAULT 'replace_pr',
      pr_description_preserve_original BOOLEAN NOT NULL DEFAULT TRUE,
      pr_description_use_markers BOOLEAN NOT NULL DEFAULT FALSE,
      pr_description_publish_labels BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS pr_description_enabled BOOLEAN NOT NULL DEFAULT TRUE`)
  await pool.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS pr_description_update_mode TEXT NOT NULL DEFAULT 'created_only'`)
  await pool.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS pr_description_publish_mode TEXT NOT NULL DEFAULT 'replace_pr'`)
  await pool.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS pr_description_preserve_original BOOLEAN NOT NULL DEFAULT TRUE`)
  await pool.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS pr_description_use_markers BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS pr_description_publish_labels BOOLEAN NOT NULL DEFAULT TRUE`)
  await pool.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS repo_settings (
      repo_id TEXT PRIMARY KEY REFERENCES repos(repo_id) ON DELETE CASCADE,
      pr_description_enabled BOOLEAN,
      pr_description_update_mode TEXT,
      pr_description_publish_mode TEXT,
      pr_description_preserve_original BOOLEAN,
      pr_description_use_markers BOOLEAN,
      pr_description_publish_labels BOOLEAN,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS pr_description_enabled BOOLEAN`)
  await pool.query(`ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS pr_description_update_mode TEXT`)
  await pool.query(`ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS pr_description_publish_mode TEXT`)
  await pool.query(`ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS pr_description_preserve_original BOOLEAN`)
  await pool.query(`ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS pr_description_use_markers BOOLEAN`)
  await pool.query(`ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS pr_description_publish_labels BOOLEAN`)
  await pool.query(`ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`)
  await pool.query(`ALTER TABLE repo_settings ALTER COLUMN pr_description_enabled DROP NOT NULL`)
  await pool.query(`ALTER TABLE repo_settings ALTER COLUMN pr_description_update_mode DROP NOT NULL`)
  await pool.query(`ALTER TABLE repo_settings ALTER COLUMN pr_description_publish_mode DROP NOT NULL`)
  await pool.query(`ALTER TABLE repo_settings ALTER COLUMN pr_description_preserve_original DROP NOT NULL`)
  await pool.query(`ALTER TABLE repo_settings ALTER COLUMN pr_description_use_markers DROP NOT NULL`)
  await pool.query(`ALTER TABLE repo_settings ALTER COLUMN pr_description_publish_labels DROP NOT NULL`)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
        ALTER TABLE users
        ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'member'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_members_role_check') THEN
        ALTER TABLE org_members
        ADD CONSTRAINT org_members_role_check CHECK (role IN ('admin', 'member'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invites_org_role_check') THEN
        ALTER TABLE invites
        ADD CONSTRAINT invites_org_role_check CHECK (org_role IN ('admin', 'member'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repos_platform_check') THEN
        ALTER TABLE repos
        ADD CONSTRAINT repos_platform_check CHECK (platform IN ('github', 'azure'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_webhook_secrets_platform_check') THEN
        ALTER TABLE org_webhook_secrets
        ADD CONSTRAINT org_webhook_secrets_platform_check CHECK (platform IN ('github', 'azure'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_platform_check') THEN
        ALTER TABLE org_settings
        ADD CONSTRAINT org_settings_platform_check CHECK (platform IN ('github', 'azure'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_update_mode_check') THEN
        ALTER TABLE org_settings
        ADD CONSTRAINT org_settings_update_mode_check CHECK (pr_description_update_mode IN ('created_only', 'created_and_updated'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_publish_mode_check') THEN
        ALTER TABLE org_settings
        ADD CONSTRAINT org_settings_publish_mode_check CHECK (pr_description_publish_mode IN ('replace_pr', 'comment'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repo_settings_update_mode_check') THEN
        ALTER TABLE repo_settings
        ADD CONSTRAINT repo_settings_update_mode_check CHECK (pr_description_update_mode IN ('created_only', 'created_and_updated') OR pr_description_update_mode IS NULL);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repo_settings_publish_mode_check') THEN
        ALTER TABLE repo_settings
        ADD CONSTRAINT repo_settings_publish_mode_check CHECK (pr_description_publish_mode IN ('replace_pr', 'comment') OR pr_description_publish_mode IS NULL);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rules_category_check') THEN
        ALTER TABLE rules
        ADD CONSTRAINT rules_category_check CHECK (category IN ('security', 'correctness', 'quality', 'reliability', 'performance', 'testability', 'compliance', 'accessibility', 'observability', 'architecture', 'custom'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rules_severity_check') THEN
        ALTER TABLE rules
        ADD CONSTRAINT rules_severity_check CHECK (severity IN ('error', 'warning', 'recommendation'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rules_scope_type_check') THEN
        ALTER TABLE rules
        ADD CONSTRAINT rules_scope_type_check CHECK (scope_type IN ('org', 'repo', 'path'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rules_source_check') THEN
        ALTER TABLE rules
        ADD CONSTRAINT rules_source_check CHECK (source IN ('manual', 'imported', 'suggested', 'discovered'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_suggestions_category_check') THEN
        ALTER TABLE rule_suggestions
        ADD CONSTRAINT rule_suggestions_category_check CHECK (category IN ('security', 'correctness', 'quality', 'reliability', 'performance', 'testability', 'compliance', 'accessibility', 'observability', 'architecture', 'custom'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_suggestions_severity_check') THEN
        ALTER TABLE rule_suggestions
        ADD CONSTRAINT rule_suggestions_severity_check CHECK (severity IN ('error', 'warning', 'recommendation'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_suggestions_scope_type_check') THEN
        ALTER TABLE rule_suggestions
        ADD CONSTRAINT rule_suggestions_scope_type_check CHECK (suggested_scope_type IN ('org', 'repo', 'path'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_suggestions_status_check') THEN
        ALTER TABLE rule_suggestions
        ADD CONSTRAINT rule_suggestions_status_check CHECK (status IN ('pending', 'approved', 'dismissed'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_violations_status_check') THEN
        ALTER TABLE rule_violations
        ADD CONSTRAINT rule_violations_status_check CHECK (status IN ('open', 'resolved', 'merged_with_violation'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_agent_telemetry_role_check') THEN
        ALTER TABLE review_agent_telemetry
        ADD CONSTRAINT review_agent_telemetry_role_check CHECK (
          agent_role IN ('security', 'correctness', 'performance', 'style_maintainability', 'ticket_compliance', 'blast_radius')
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_agent_telemetry_verdict_check') THEN
        ALTER TABLE review_agent_telemetry
        ADD CONSTRAINT review_agent_telemetry_verdict_check CHECK (verdict IN ('approve', 'request_changes', 'comment'));
      END IF;
    END
    $$;
  `)
  const commentEmbDim = embeddingForMigration?.dim ?? 1536
  await pool.query(
    `ALTER TABLE review_comments ADD COLUMN IF NOT EXISTS embedding vector(${commentEmbDim})`
  )
  await pool.query(`ALTER TABLE review_comments ADD COLUMN IF NOT EXISTS confidence FLOAT`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_api_keys (
      id INT PRIMARY KEY DEFAULT 1,
      api_key TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    )
  `)
  if (process.env.API_KEY) {
    await pool.query(
      `INSERT INTO system_api_keys (id, api_key) VALUES (1, $1) ON CONFLICT DO NOTHING`,
      [process.env.API_KEY],
    )
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_review_state (
      repo_id   TEXT NOT NULL,
      pr_number INT  NOT NULL,
      platform  TEXT NOT NULL DEFAULT 'azure',
      last_reviewed_iteration INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (repo_id, pr_number, platform)
    )
  `)
  // Safety net: ensure unique constraint exists even if the table was created by an older migration
  // without the PRIMARY KEY — ON CONFLICT requires it for the UPSERT in saveLastReviewedIteration
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pr_review_state_uq
    ON pr_review_state (repo_id, pr_number, platform)
  `)
  app.log.info('Database schema migrated')
  await seedAdminUser(pool)

  // Multi-org migration/backfill for existing single-tenant installs
  const defaultOrgName = process.env.DEFAULT_ORG_NAME || 'Default Organization'
  const defaultOrgSlug = 'default'
  const defaultOrgIdRes = await pool.query<{ id: string }>(
    `INSERT INTO organizations (id, slug, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['00000000-0000-0000-0000-000000000001', defaultOrgSlug, defaultOrgName],
  )
  const defaultOrgId = defaultOrgIdRes.rows[0].id

  await pool.query(
    `INSERT INTO org_members (org_id, user_id, role)
     SELECT $1, u.id, 'admin'
     FROM users u
     WHERE u.is_system_admin = true
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [defaultOrgId],
  )
  // Cleanup: remove accidental default-org memberships for non-system users who already belong
  // to at least one non-default org. This prevents org switching to default unless explicitly invited.
  await pool.query(
    `DELETE FROM org_members om
     USING organizations o, users u
     WHERE om.org_id = o.id
       AND o.slug = $1
       AND u.id = om.user_id
       AND COALESCE(u.is_system_admin, false) = false
       AND EXISTS (
         SELECT 1
         FROM org_members om2
         WHERE om2.user_id = om.user_id
           AND om2.org_id <> om.org_id
       )`,
    [defaultOrgSlug],
  )
  await pool.query(
    `UPDATE repos SET org_id = $1 WHERE org_id IS NULL`,
    [defaultOrgId],
  )
  if (process.env.WEBHOOK_SECRET) {
    await pool.query(
      `INSERT INTO org_webhook_secrets (id, org_id, platform, secret)
       VALUES ($1, $2, 'github', $3), ($4, $2, 'azure', $3)
       ON CONFLICT (org_id, platform) DO NOTHING`,
      [crypto.randomUUID(), defaultOrgId, process.env.WEBHOOK_SECRET, crypto.randomUUID()],
    )
  }

  try {
    await warmupAllRepos()
    app.log.info('Graph cache warmed up')
  } catch (err) {
    app.log.warn({ err }, 'Graph warmup failed (no repos registered yet)')
  }

  const port = parseInt(process.env.PORT ?? '3000', 10)
  const host = process.env.HOST ?? '0.0.0.0'
  await app.listen({ port, host })
}

// Only start the server when run directly (not when imported by tests)
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}

export { buildServer }
