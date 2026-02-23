/**
 * In-memory cache: `${repoId}:${branch}` → { graph, retriever, indexer, storage }
 *
 * One InMemorySymbolGraph per (repo, branch) pair, deserialized from Postgres on startup.
 * All webhook handlers look up their graph from here by repoId + branch.
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

function branchKey(repoId: string, branch: string): string {
  return `${repoId}:${branch}`
}

export function initGraphCache(pool: Pool, defaultDepth: ReviewDepth = 'standard'): void {
  _pool = pool
  _defaultDepth = defaultDepth
}

/**
 * Load all registered (repo, branch) pairs from `repo_branches` and warm up their graphs.
 * Called once on server startup.
 */
export async function warmupAllRepos(): Promise<void> {
  if (!_pool) throw new Error('GraphCache not initialized — call initGraphCache() first')

  // repo_branches may not exist yet (first run before any repo is registered)
  try {
    const res = await _pool.query<{ repo_id: string; branch: string }>(
      'SELECT repo_id, branch FROM repo_branches',
    )
    await Promise.all(res.rows.map(row => loadRepo(row.repo_id, row.branch)))
  } catch {
    // Table doesn't exist yet — fall back to repos table with 'main' branch
    const res = await _pool.query<{ repo_id: string }>('SELECT repo_id FROM repos')
    await Promise.all(res.rows.map(row => loadRepo(row.repo_id, 'main')))
  }
}

/**
 * Load (or reload) one (repo, branch) graph from Postgres into memory.
 */
export async function loadRepo(repoId: string, branch: string): Promise<RepoCacheEntry> {
  if (!_pool) throw new Error('GraphCache not initialized')

  const storage = new PostgresStorageAdapter(_pool)
  const graph = new InMemorySymbolGraph()
  const registry = await createDefaultRegistry()
  const embeddingAdapter = createEmbeddingAdapter(_pool)
  const indexer = new Indexer(registry, graph, storage, embeddingAdapter)

  await indexer.loadFromStorage(repoId, branch)

  const retriever = new Retriever(graph, embeddingAdapter, { depth: _defaultDepth })
  const entry: RepoCacheEntry = { graph, retriever, indexer, storage }
  cache.set(branchKey(repoId, branch), entry)
  return entry
}

/**
 * Get the cache entry for a (repo, branch) pair. Returns null if not loaded.
 */
export function getRepo(repoId: string, branch: string): RepoCacheEntry | null {
  return cache.get(branchKey(repoId, branch)) ?? null
}

/**
 * Get or load a (repo, branch) cache entry.
 */
export async function getOrLoadRepo(repoId: string, branch: string): Promise<RepoCacheEntry> {
  return cache.get(branchKey(repoId, branch)) ?? loadRepo(repoId, branch)
}

/**
 * Evict a repo's graph(s) from memory.
 * If `branch` is provided, evict only that branch; otherwise evict all branches for the repo.
 */
export function evictRepo(repoId: string, branch?: string): void {
  if (branch !== undefined) {
    cache.delete(branchKey(repoId, branch))
  } else {
    // Evict all branches for this repo
    const prefix = `${repoId}:`
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key)
      }
    }
  }
}
