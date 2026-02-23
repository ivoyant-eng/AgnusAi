import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import path from 'path'
import { Pool } from 'pg'
import { webhookRoutes } from './routes/webhooks'
import { repoRoutes } from './routes/repos'
import { initGraphCache, warmupAllRepos } from './graph-cache'

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

  // Landing page — matches dashboard TinyFish aesthetic
  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgnusAI — AI Code Review</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #EBEBEA;
      --fg: #111111;
      --orange: #E85A1A;
      --border: #D1D1CF;
      --muted: #6B6B6B;
      --muted-bg: #E3E3E1;
    }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
    }
    .meta {
      font-size: 0.7rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 400;
    }
    /* ── Header ── */
    header {
      border-bottom: 1px solid var(--border);
    }
    .header-inner {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      background: var(--orange);
      color: #fff;
      font-size: 0.68rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      padding: 2px 8px;
      font-weight: 400;
    }
    nav {
      display: flex;
    }
    nav a {
      font-size: 0.68rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      text-decoration: none;
      padding: 0 16px;
      height: 48px;
      display: flex;
      align-items: center;
      border-left: 1px solid var(--border);
      transition: color 0.15s;
    }
    nav a:hover { color: var(--fg); }
    /* ── Main ── */
    main {
      flex: 1;
      max-width: 1280px;
      margin: 0 auto;
      width: 100%;
      padding: 48px 24px 80px;
    }
    .eyebrow { margin-bottom: 16px; }
    h1 {
      font-size: clamp(3.5rem, 9vw, 7.5rem);
      font-weight: 800;
      line-height: 0.95;
      letter-spacing: -0.03em;
      color: var(--fg);
      margin-bottom: 40px;
    }
    .desc {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: var(--muted);
      max-width: 480px;
      line-height: 1.7;
      margin-bottom: 48px;
    }
    /* ── Steps ── */
    .steps { border-top: 1px solid var(--border); margin-bottom: 48px; max-width: 640px; }
    .step {
      display: flex;
      align-items: flex-start;
      gap: 32px;
      border-bottom: 1px solid var(--border);
      padding: 20px 0;
    }
    .step-num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      color: var(--muted);
      letter-spacing: 0.08em;
      width: 32px;
      flex-shrink: 0;
    }
    .step-title { font-weight: 500; font-size: 0.95rem; margin-bottom: 2px; }
    .step-desc { font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
    /* ── CTAs ── */
    .ctas { display: flex; gap: 0; flex-wrap: wrap; }
    .cta-primary {
      background: var(--fg);
      color: var(--bg);
      text-decoration: none;
      height: 48px;
      padding: 0 32px;
      font-size: 0.7rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      display: inline-flex;
      align-items: center;
      gap: 12px;
      transition: opacity 0.15s;
      border: 1px solid var(--fg);
    }
    .cta-primary:hover { opacity: 0.82; }
    .cta-secondary {
      background: transparent;
      color: var(--fg);
      text-decoration: none;
      height: 48px;
      padding: 0 32px;
      font-size: 0.7rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      display: inline-flex;
      align-items: center;
      gap: 12px;
      border: 1px solid var(--border);
      border-left: none;
      transition: background 0.15s;
    }
    .cta-secondary:hover { background: var(--muted-bg); }
    /* ── Features ── */
    .features-section { margin-top: 80px; }
    .features-section > .meta { margin-bottom: 24px; }
    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      border-top: 1px solid var(--border);
      border-left: 1px solid var(--border);
    }
    .feature-card {
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      padding: 28px 24px;
    }
    .feature-icon { font-size: 1.2rem; margin-bottom: 12px; }
    .feature-title { font-size: 0.88rem; font-weight: 600; margin-bottom: 6px; color: var(--fg); }
    .feature-desc { font-size: 0.75rem; line-height: 1.6; color: var(--muted); }
    .feature-tag {
      display: inline-block;
      font-size: 0.6rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--orange);
      border: 1px solid var(--orange);
      padding: 1px 6px;
      margin-top: 10px;
    }
    @media (max-width: 768px) {
      .features-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 480px) {
      .features-grid { grid-template-columns: 1fr; }
    }
    /* ── Stats strip ── */
    .stats {
      display: flex;
      border-top: 1px solid var(--border);
      margin-top: 64px;
      max-width: 640px;
    }
    .stat {
      flex: 1;
      padding: 20px 0;
      border-right: 1px solid var(--border);
    }
    .stat:last-child { border-right: none; }
    .stat-num {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--fg);
      letter-spacing: -0.02em;
    }
    .stat-label { font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-top: 2px; }
    /* ── Footer ticker ── */
    footer {
      background: var(--fg);
      color: var(--bg);
      border-top: 1px solid var(--border);
      overflow: hidden;
    }
    @keyframes ticker {
      from { transform: translateX(0); }
      to   { transform: translateX(-50%); }
    }
    .ticker-track {
      display: flex;
      animation: ticker 28s linear infinite;
      width: max-content;
    }
    .ticker-item {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 12px 32px;
      font-size: 0.68rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(235,235,234,0.6);
      border-right: 1px solid rgba(235,235,234,0.1);
      white-space: nowrap;
    }
    .ticker-dot { color: var(--orange); }
    @media (max-width: 640px) {
      nav a:not(:last-child) { display: none; }
      h1 { font-size: clamp(3rem, 14vw, 5rem); }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="brand">
        <span class="badge">AgnusAI</span>
        <span class="meta" style="color: rgba(107,107,107,0.6)">Code Review</span>
      </div>
      <nav>
        <a href="/app/">Dashboard</a>
        <a href="/docs/">Docs</a>
        <a href="https://github.com/ivoyant-eng/AgnusAi">GitHub</a>
      </nav>
    </div>
  </header>

  <main>
    <p class="meta eyebrow">Open Source · Self-Hosted · Graph-Aware</p>

    <h1>AI reviews<br/>that see the<br/>whole picture.</h1>

    <p class="desc">
      AgnusAI indexes your codebase with Tree-sitter, builds a symbol dependency graph,
      and uses blast-radius analysis to give every PR review real context —
      not just the diff.
    </p>

    <div class="steps">
      <div class="step">
        <span class="step-num">01</span>
        <div>
          <p class="step-title">Connect a repository</p>
          <p class="step-desc">GitHub or Azure DevOps. Add your token once.</p>
        </div>
      </div>
      <div class="step">
        <span class="step-num">02</span>
        <div>
          <p class="step-title">Index the codebase</p>
          <p class="step-desc">Tree-sitter parses symbols &amp; edges. Stored in Postgres.</p>
        </div>
      </div>
      <div class="step">
        <span class="step-num">03</span>
        <div>
          <p class="step-title">Get graph-aware PR reviews</p>
          <p class="step-desc">Every push triggers incremental re-index. Every PR gets blast radius context.</p>
        </div>
      </div>
    </div>

    <div class="ctas">
      <a class="cta-primary" href="/app/">Open Dashboard →</a>
      <a class="cta-secondary" href="/docs/">Read the Docs</a>
      <a class="cta-secondary" href="https://github.com/ivoyant-eng/AgnusAi" style="border-left: none;">View on GitHub</a>
    </div>

    <div class="features-section">
      <p class="meta">What makes it different</p>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">🔍</div>
          <div class="feature-title">Diff-aware Reviews</div>
          <div class="feature-desc">Reviews only what changed. Checkpoints prevent re-reviewing unchanged files on every push.</div>
          <span class="feature-tag">Incremental</span>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🕸️</div>
          <div class="feature-title">Graph-aware Blast Radius</div>
          <div class="feature-desc">Builds a dependency graph using Tree-sitter. Knows which callers are affected before the LLM sees a single line.</div>
          <span class="feature-tag">2-hop BFS</span>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🧠</div>
          <div class="feature-title">Semantic Neighbors</div>
          <div class="feature-desc">Embeds all symbols via pgvector. In deep mode, semantically similar code is surfaced even without a direct graph edge.</div>
          <span class="feature-tag">Deep Mode</span>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔌</div>
          <div class="feature-title">Any LLM, Any Embedding</div>
          <div class="feature-desc">Ollama, OpenAI, Claude, Azure OpenAI for generation. Ollama, OpenAI, Google, or any OpenAI-compatible URL for embeddings.</div>
          <span class="feature-tag">Provider-agnostic</span>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🌐</div>
          <div class="feature-title">Multi-language Parsers</div>
          <div class="feature-desc">TypeScript, JavaScript, Python, Java, Go, C# — all parsed with Tree-sitter WASM. No language server required.</div>
          <span class="feature-tag">Tree-sitter</span>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🐳</div>
          <div class="feature-title">Self-hostable</div>
          <div class="feature-desc">One <code style="font-family:JetBrains Mono,monospace;font-size:0.72rem">docker compose up</code>. Postgres + pgvector + Ollama included. No cloud dependency.</div>
          <span class="feature-tag">MIT License</span>
        </div>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-num">5</div>
        <div class="stat-label">Languages</div>
      </div>
      <div class="stat">
        <div class="stat-num">4</div>
        <div class="stat-label">LLM Providers</div>
      </div>
      <div class="stat">
        <div class="stat-num">2-hop</div>
        <div class="stat-label">Graph Traversal</div>
      </div>
      <div class="stat">
        <div class="stat-num">MIT</div>
        <div class="stat-label">License</div>
      </div>
    </div>
  </main>

  <footer>
    <div class="ticker-track">
      ${[
        'Graph-Aware Review', 'Tree-Sitter Parsing', 'Postgres + pgvector',
        'Blast Radius Analysis', 'Webhook Triggered', '100% Self-Hosted',
        'Open Source', 'Incremental Indexing', 'TypeScript · Python · Java · C#',
        'Ollama · OpenAI · Claude · Azure',
      ].concat([
        'Graph-Aware Review', 'Tree-Sitter Parsing', 'Postgres + pgvector',
        'Blast Radius Analysis', 'Webhook Triggered', '100% Self-Hosted',
        'Open Source', 'Incremental Indexing', 'TypeScript · Python · Java · C#',
        'Ollama · OpenAI · Claude · Azure',
      ]).map(t => `<span class="ticker-item"><span class="ticker-dot">•</span>${t}</span>`).join('')}
    </div>
  </footer>
</body>
</html>`)
  })

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // Routes
  await app.register(webhookRoutes)
  await app.register(repoRoutes)

  // Serve VitePress docs at /docs
  const docsDist = process.env.DOCS_DIST ??
    path.join(__dirname, '../../docs/.vitepress/dist')
  const fs = await import('fs')
  if (fs.existsSync(docsDist)) {
    // /docs → /docs/ redirect (static plugin only handles /docs/*)
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

  // Optional: serve dashboard static files if DASHBOARD_DIST is set
  const dashboardDist = process.env.DASHBOARD_DIST ??
    path.join(__dirname, '../../dashboard/dist')
  try {
    const fs = await import('fs')
    if (fs.existsSync(dashboardDist)) {
      const fastifyStatic = await import('@fastify/static')
      await app.register(fastifyStatic.default, {
        root: dashboardDist,
        prefix: '/app',
        decorateReply: false,
      })
    }
  } catch {
    // Dashboard not built yet — skip static file serving
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  app.log.info('Database schema migrated')

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
