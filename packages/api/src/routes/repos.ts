import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { createDefaultRegistry, Indexer, InMemorySymbolGraph, PostgresStorageAdapter } from '@agnus-ai/core'
import type { IndexProgress } from '@agnus-ai/shared'
import { loadRepo, getOrLoadRepo, evictRepo } from '../graph-cache'
import { createEmbeddingAdapter } from '../embedding-factory'

export async function repoRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db

  /**
   * POST /api/repos — register a repo and trigger async full index
   * Body: { repoUrl, platform, token, repoPath }
   */
  app.post('/api/repos', async (req, reply) => {
    const { repoUrl, platform, token, repoPath } = req.body as {
      repoUrl: string
      platform: 'github' | 'azure'
      token?: string
      repoPath?: string
    }

    if (!repoUrl || !platform) {
      return reply.status(400).send({ error: 'repoUrl and platform are required' })
    }

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
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await pool.query(
      `INSERT INTO repos (repo_id, repo_url, platform, token, repo_path)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (repo_id) DO UPDATE SET token = EXCLUDED.token, repo_path = EXCLUDED.repo_path`,
      [repoId, repoUrl, platform, token ?? null, repoPath ?? null],
    )

    // Trigger full index in background (no await — we'll track via SSE)
    setImmediate(async () => {
      try {
        const embeddingAdapter = createEmbeddingAdapter(pool)
        const storage = new PostgresStorageAdapter(pool)
        await storage.migrate(embeddingAdapter?.dim ?? 1024)
        const graph = new InMemorySymbolGraph()
        const registry = await createDefaultRegistry()
        const indexer = new Indexer(registry, graph, storage, embeddingAdapter)
        const path = repoPath ?? repoUrl.split('/').pop() ?? repoId

        await indexer.fullIndex(path, repoId, (progress) => {
          // Store latest progress so SSE route can read it
          setProgress(repoId, progress)
        })

        await loadRepo(repoId)
        setProgress(repoId, null) // done
      } catch (err) {
        console.error(`[repos] Full index failed for ${repoId}:`, (err as Error).message)
      }
    })

    return reply.status(202).send({ repoId, message: 'Indexing started — stream progress at /api/repos/' + repoId + '/index/status' })
  })

  /**
   * GET /api/repos/:id/index/status — SSE stream of indexing progress
   */
  app.get('/api/repos/:id/index/status', async (req, reply) => {
    const { id: repoId } = req.params as { id: string }

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders()

    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    // Poll progress every 500ms until done or connection closes
    let done = false
    const interval = setInterval(() => {
      const progress = getProgress(repoId)
      if (progress) {
        send(progress)
        if (progress.step === 'done') {
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
   */
  app.get('/api/repos/:id/graph/blast-radius/:symbolId', async (req, reply) => {
    const { id: repoId, symbolId } = req.params as { id: string; symbolId: string }
    const entry = await getOrLoadRepo(repoId)
    const br = entry.graph.getBlastRadius([decodeURIComponent(symbolId)])
    return reply.send(br)
  })

  /**
   * DELETE /api/repos/:id
   */
  app.delete('/api/repos/:id', async (req, reply) => {
    const { id: repoId } = req.params as { id: string }
    await pool.query('DELETE FROM repos WHERE repo_id = $1', [repoId])
    evictRepo(repoId)
    return reply.status(204).send()
  })
}

// ----- Simple in-process progress store -----
const progressStore = new Map<string, IndexProgress | null>()

function setProgress(repoId: string, progress: IndexProgress | null): void {
  progressStore.set(repoId, progress)
}

function getProgress(repoId: string): IndexProgress | null | undefined {
  return progressStore.get(repoId)
}
