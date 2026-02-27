import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import fastifyCookie from '@fastify/cookie'
import fastifyJwt from '@fastify/jwt'
import path from 'path'
import { Pool } from 'pg'
import { webhookRoutes } from './routes/webhooks'
import { repoRoutes } from './routes/repos'
import { authRoutes } from './routes/auth'
import { feedbackRoutes } from './routes/feedback'
import { initGraphCache, warmupAllRepos } from './graph-cache'
import { seedAdminUser } from './auth/seed'
import { requireAuth } from './auth/middleware'

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
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 })

  await app.register(sensible)
  await app.register(fastifyCookie)
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? 'changeme',
    cookie: { cookieName: 'agnus_session', signed: false },
  })

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
  await app.register(authRoutes)
  await app.register(webhookRoutes)
  await app.register(repoRoutes)
  await app.register(feedbackRoutes)

  // GET /api/repos/:id/precision — per-confidence-bucket acceptance rates (auth required)
  app.get('/api/repos/:id/precision', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
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
    const { rows } = await app.db.query(`
      SELECT r.id, r.repo_id, r.pr_number, r.verdict, r.comment_count, r.created_at,
             repos.repo_url
      FROM reviews r
      LEFT JOIN repos ON repos.repo_id = r.repo_id
      ORDER BY r.created_at DESC LIMIT 50
    `)
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      email TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
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
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      review_depth TEXT NOT NULL DEFAULT 'standard'
    )
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
  app.log.info('Database schema migrated')
  await seedAdminUser(pool)

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
