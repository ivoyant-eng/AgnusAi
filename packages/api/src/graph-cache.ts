/**
 * In-memory cache: repoId → { graph, retriever }
 *
 * One InMemorySymbolGraph per registered repo, deserialized from Postgres on startup.
 * All webhook handlers look up their graph from here by repoId.
 */
import { Pool } from 'pg'
import {
  InMemorySymbolGraph,
  PostgresStorageAdapter,
  Retriever,
  createDefaultRegistry,
  Indexer,
} from '@agnus-ai/core'
import type { ReviewDepth } from '@agnus-ai/core'
import { createEmbeddingAdapter } from './embedding-factory'

export interface RepoCacheEntry {
  graph: InMemorySymbolGraph
  retriever: Retriever
  indexer: Indexer
  storage: PostgresStorageAdapter
}

const cache = new Map<string, RepoCacheEntry>()
let _pool: Pool | null = null
let _defaultDepth: ReviewDepth = 'standard'

export function initGraphCache(pool: Pool, defaultDepth: ReviewDepth = 'standard'): void {
  _pool = pool
  _defaultDepth = defaultDepth
}

/**
 * Load all registered repos from the `repos` table and warm up their graphs.
 * Called once on server startup.
 */
export async function warmupAllRepos(): Promise<void> {
  if (!_pool) throw new Error('GraphCache not initialized — call initGraphCache() first')
  const res = await _pool.query<{ repo_id: string }>('SELECT repo_id FROM repos')
  await Promise.all(res.rows.map(row => loadRepo(row.repo_id)))
}

/**
 * Load (or reload) one repo's graph from Postgres into memory.
 */
export async function loadRepo(repoId: string): Promise<RepoCacheEntry> {
  if (!_pool) throw new Error('GraphCache not initialized')

  const storage = new PostgresStorageAdapter(_pool)
  const graph = new InMemorySymbolGraph()
  const registry = await createDefaultRegistry()
  const embeddingAdapter = createEmbeddingAdapter(_pool)
  const indexer = new Indexer(registry, graph, storage, embeddingAdapter)

  await indexer.loadFromStorage(repoId)

  const retriever = new Retriever(graph, embeddingAdapter, { depth: _defaultDepth })
  const entry: RepoCacheEntry = { graph, retriever, indexer, storage }
  cache.set(repoId, entry)
  return entry
}

/**
 * Get the cache entry for a repo. Returns null if not loaded.
 */
export function getRepo(repoId: string): RepoCacheEntry | null {
  return cache.get(repoId) ?? null
}

/**
 * Get or load a repo's cache entry.
 */
export async function getOrLoadRepo(repoId: string): Promise<RepoCacheEntry> {
  return cache.get(repoId) ?? loadRepo(repoId)
}

/**
 * Evict a repo's graph from memory (e.g. on repo deletion).
 */
export function evictRepo(repoId: string): void {
  cache.delete(repoId)
}
