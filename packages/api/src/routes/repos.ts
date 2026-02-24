import { existsSync, mkdirSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'

const execAsync = promisify(exec)

/** Directory where repos are auto-cloned when no repoPath is provided */
const REPOS_DIR = process.env.REPOS_DIR ?? '/repos'
import { createDefaultRegistry, Indexer, InMemorySymbolGraph, PostgresStorageAdapter } from '@agnus-ai/core'
import type { IndexProgress } from '@agnus-ai/shared'
import { loadRepo, getOrLoadRepo, evictRepo } from '../graph-cache'
import { createEmbeddingAdapter } from '../embedding-factory'
import { requireAuth } from '../auth/middleware'
import { runReview } from '../review-runner'

export async function repoRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db

  /**
   * GET /api/repos — list all registered repos (auth required)
   */
  app.get('/api/repos', { preHandler: [requireAuth] }, async (_req, reply) => {
    const { rows } = await pool.query(
      'SELECT repo_id, repo_url, platform, repo_path, indexed_at, symbol_count, created_at FROM repos ORDER BY created_at DESC',
    )
    return reply.send(rows.map(r => ({
      repoId: r.repo_id,
      repoUrl: r.repo_url,
      platform: r.platform,
      repoPath: r.repo_path,
      indexedAt: r.indexed_at,
      symbolCount: r.symbol_count ?? 0,
      createdAt: r.created_at,
    })))
  })

  /**
   * POST /api/repos — register a repo and trigger async full index per branch
   * Body: { repoUrl, platform, token, repoPath, branches? }
   */
  app.post('/api/repos', { preHandler: [requireAuth] }, async (req, reply) => {
    const { repoUrl, platform, token, repoPath, branches } = req.body as {
      repoUrl: string
      platform: 'github' | 'azure'
      token?: string
      repoPath?: string
      branches?: string[]
    }

    if (!repoUrl || !platform) {
      return reply.status(400).send({ error: 'repoUrl and platform are required' })
    }

    const indexBranches = (branches && branches.length > 0) ? branches : ['main']

    // Derive a stable repoId from the URL
    const repoId = Buffer.from(repoUrl).toString('base64url').slice(0, 32)

    // Ensure repos table exists and upsert the registration
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
    await pool.query(
      `INSERT INTO repos (repo_id, repo_url, platform, token, repo_path)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (repo_id) DO UPDATE SET token = EXCLUDED.token, repo_path = EXCLUDED.repo_path`,
      [repoId, repoUrl, platform, token ?? null, repoPath ?? null],
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
      runFullIndex(pool, repoId, repoPath ?? null, indexBranches, repoUrl, token)
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

    const { rows } = await pool.query(
      'SELECT repo_url, repo_path, token FROM repos WHERE repo_id = $1',
      [repoId],
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
      runFullIndex(pool, repoId, rows[0].repo_path, branches, rows[0].repo_url, rows[0].token)
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
    const { prNumber, baseBranch = 'main', dryRun = false } = req.body as { prNumber: number; baseBranch?: string; dryRun?: boolean }

    if (!prNumber) {
      return reply.status(400).send({ error: 'prNumber is required' })
    }

    const { rows } = await pool.query(
      'SELECT repo_url, platform, token FROM repos WHERE repo_id = $1',
      [repoId],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Repo not found' })
    }

    const { repo_url: repoUrl, platform, token } = rows[0]

    // Run review synchronously so the caller gets the result
    try {
      const result = await runReview({
        platform,
        repoId,
        repoUrl,
        prNumber,
        baseBranch,
        token: token ?? undefined,
        pool,
        dryRun,
      })

      const { verdict, commentCount, comments } = result
      return reply.send({ verdict, commentCount, prNumber, repoId, ...(dryRun ? { dryRun: true, comments } : {}) })
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[repos] Manual review failed for PR ${prNumber}:`, msg)
      return reply.status(500).send({ error: msg })
    }
  })

  /**
   * DELETE /api/repos/:id — evict all branches from cache and remove from DB
   */
  app.delete('/api/repos/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    await pool.query('DELETE FROM repos WHERE repo_id = $1', [repoId])
    evictRepo(repoId) // evicts all branches (no branch arg = evict all)
    return reply.status(204).send()
  })

  /**
   * GET /api/repos/:id/feedback-metrics — weekly accepted/rejected feedback counts (auth required)
   */
  app.get('/api/repos/:id/feedback-metrics', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id: repoId } = req.params as { id: string }

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
}

// ----- Background full-index runner (shared by POST /repos and POST /repos/:id/reindex) -----
async function runFullIndex(
  pool: Pool,
  repoId: string,
  repoPath: string | null,
  indexBranches: string[],
  repoUrl?: string,
  token?: string | null,
): Promise<void> {
  let resolvedPath = repoPath

  // Auto-clone if no repoPath provided
  if (!resolvedPath) {
    if (!repoUrl) {
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

    const cloneDir = `${REPOS_DIR}/${repoId}`
    try {
      if (!existsSync(cloneDir)) {
        const cloneUrl = buildAuthenticatedUrl(repoUrl, token ?? null)
        console.log(`[repos] Auto-cloning ${repoUrl} → ${cloneDir}`)
        await execAsync(`git clone --depth=1 "${cloneUrl}" "${cloneDir}"`, { timeout: 300_000 })
      } else {
        // Pull latest on the current branch
        console.log(`[repos] Pulling latest in ${cloneDir}`)
        await execAsync(`git -C "${cloneDir}" pull --ff-only`, { timeout: 120_000 })
      }
    } catch (err) {
      const errMsg = `Clone failed: ${(err as Error).message.split('\n')[0]}`
      console.error(`[repos] ${errMsg}`)
      for (const branch of indexBranches) setProgress(`${repoId}:${branch}`, { step: 'error', message: errMsg })
      return
    }

    resolvedPath = cloneDir
    // Persist the resolved path so reindex can reuse it
    await pool.query('UPDATE repos SET repo_path = $1 WHERE repo_id = $2', [resolvedPath, repoId])
  }

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

/** Build an authenticated clone URL by embedding the token as password */
function buildAuthenticatedUrl(repoUrl: string, token: string | null): string {
  if (!token) return repoUrl
  try {
    const url = new URL(repoUrl)
    if (repoUrl.includes('dev.azure.com')) {
      url.username = 'oauth2'
      url.password = token
    } else {
      // GitHub / GitLab / others
      url.username = token
      url.password = 'x-oauth-basic'
    }
    return url.toString()
  } catch {
    return repoUrl
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
