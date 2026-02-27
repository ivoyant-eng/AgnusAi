import fs from 'fs/promises'
import path from 'path'
import type { IndexProgress, IndexStats } from '@agnus-ai/shared'
import type { ParserRegistry } from '../parser/ParserRegistry'
import type { InMemorySymbolGraph } from '../graph/InMemorySymbolGraph'
import type { StorageAdapter } from '../storage/StorageAdapter'
import type { EmbeddingAdapter } from '../embeddings/EmbeddingAdapter'

/** Number of symbols to embed per batch (avoid overwhelming the embedding server) */
const EMBED_BATCH_SIZE = 32

/** File extensions to scan during full indexing */
const INDEXED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.cs'])

/** Directories to skip */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', '__pycache__',
  'coverage', '.turbo', 'target',
])

export class Indexer {
  constructor(
    private readonly registry: ParserRegistry,
    private readonly graph: InMemorySymbolGraph,
    private readonly storage: StorageAdapter,
    private readonly embeddings: EmbeddingAdapter | null = null,
  ) {}

  /**
   * Walk all source files in `repoPath`, parse them, and persist symbols + edges.
   * Progress events are emitted via `onProgress` for SSE streaming.
   */
  async fullIndex(
    repoPath: string,
    repoId: string,
    branch: string,
    onProgress?: (p: IndexProgress) => void,
  ): Promise<IndexStats> {
    const start = Date.now()
    // Clear stale symbols/edges from a previous full-index run before re-indexing
    await this.storage.deleteAllForBranch(repoId, branch)
    const files = await collectFiles(repoPath)
    let symbolCount = 0
    let edgeCount = 0

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      const relPath = path.relative(repoPath, filePath)
      const ext = path.extname(filePath).toLowerCase()
      if (!INDEXED_EXTENSIONS.has(ext)) continue

      onProgress?.({ step: 'parsing', file: relPath, progress: i + 1, total: files.length })

      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const result = this.registry.parseFile(relPath, content, repoId)
        if (!result) continue

        this.graph.addSymbol && result.symbols.forEach(s => this.graph.addSymbol(s))
        result.edges.forEach(e => this.graph.addEdge(e))

        // Persist — attach repoId to edges for storage
        const edgesWithRepo = result.edges.map(e => ({ ...e, repoId }))
        await this.storage.saveSymbols(result.symbols, branch)
        await this.storage.saveEdges(edgesWithRepo, branch)

        symbolCount += result.symbols.length
        edgeCount += result.edges.length
      } catch (err) {
        console.warn(`[Indexer] Skipping ${relPath}: ${(err as Error).message}`)
      }
    }

    const snapshot = this.graph.serialize()
    await this.storage.saveGraphSnapshot(repoId, branch, snapshot)

    // Embed all symbols if an embedding adapter is configured
    if (this.embeddings) {
      const allSymbols = this.graph.getAllSymbols().filter(s => s.repoId === repoId)
      await this.embedBatch(allSymbols, repoId, branch, (done) => {
        onProgress?.({ step: 'embedding', symbolCount: allSymbols.length, progress: done, total: allSymbols.length })
      })
    }

    const stats: IndexStats = {
      symbolCount,
      edgeCount,
      fileCount: files.length,
      durationMs: Date.now() - start,
    }

    onProgress?.({ step: 'done', symbolCount, edgeCount, durationMs: stats.durationMs })
    return stats
  }

  /**
   * Re-index only the changed files.
   * Removes old symbols/edges for each file before re-parsing.
   */
  async incrementalUpdate(changedFiles: string[], repoId: string, branch: string, repoPath?: string): Promise<void> {
    for (const relPath of changedFiles) {
      this.graph.removeFile(relPath)
      await this.storage.deleteByFile(relPath, repoId, branch)

      try {
        const absPath = repoPath ? path.join(repoPath, relPath) : relPath
        const content = await fs.readFile(absPath, 'utf-8')
        const result = this.registry.parseFile(relPath, content, repoId)
        if (!result) continue

        result.symbols.forEach(s => this.graph.addSymbol(s))
        result.edges.forEach(e => this.graph.addEdge(e))

        const edgesWithRepo = result.edges.map(e => ({ ...e, repoId }))
        await this.storage.saveSymbols(result.symbols, branch)
        await this.storage.saveEdges(edgesWithRepo, branch)

        if (this.embeddings && result.symbols.length > 0) {
          await this.embedBatch(result.symbols, repoId, branch)
        }
      } catch (err) {
        console.warn(`[Indexer] Incremental update failed for ${relPath}: ${(err as Error).message}`)
      }
    }

    const snapshot = this.graph.serialize()
    await this.storage.saveGraphSnapshot(repoId, branch, snapshot)
  }

  /**
   * Embed a list of symbols in batches and upsert into the vector store.
   */
  private async embedBatch(
    symbols: import('@agnus-ai/shared').ParsedSymbol[],
    repoId: string,
    branch: string,
    onProgress?: (done: number) => void,
  ): Promise<void> {
    if (!this.embeddings) return
    let done = 0
    onProgress?.(0)
    for (let i = 0; i < symbols.length; i += EMBED_BATCH_SIZE) {
      const batch = symbols.slice(i, i + EMBED_BATCH_SIZE)
      const texts = batch.map(s => `${s.signature}${s.docComment ? ' ' + s.docComment : ''}`)
      try {
        const vectors = await this.embeddings.embed(texts)
        for (let j = 0; j < batch.length; j++) {
          await this.embeddings.upsert(batch[j].id, repoId, branch, vectors[j])
        }
      } catch (err) {
        console.warn(`[Indexer] Embedding batch failed (i=${i}): ${(err as Error).message}`)
      }
      done += batch.length
      onProgress?.(done)
    }
  }

  /**
   * Load persisted symbols/edges from storage and rebuild the in-memory graph.
   * Call on startup to avoid re-indexing.
   */
  async loadFromStorage(repoId: string, branch: string): Promise<void> {
    const snapshot = await this.storage.loadGraphSnapshot(repoId, branch)
    if (snapshot) {
      // Rebuild from snapshot (faster than row-by-row)
      const { InMemorySymbolGraph } = await import('../graph/InMemorySymbolGraph')
      const loaded = InMemorySymbolGraph.deserialize(snapshot)
      // Merge into existing graph
      for (const sym of loaded.getAllSymbols()) this.graph.addSymbol(sym)
      for (const edge of loaded.getAllEdges()) this.graph.addEdge(edge)
      return
    }

    // Fallback: load from rows
    const { symbols, edges } = await this.storage.loadAll(repoId, branch)
    for (const s of symbols) this.graph.addSymbol(s)
    for (const e of edges) this.graph.addEdge(e)
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  async function walk(current: string): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true }) as import('fs').Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name as string)) continue
      const full = path.join(current, entry.name as string)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        results.push(full)
      }
    }
  }
  await walk(dir)
  return results
}
