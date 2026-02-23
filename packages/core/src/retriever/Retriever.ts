import type { ParsedSymbol, GraphReviewContext } from '@agnus-ai/shared'
import type { InMemorySymbolGraph } from '../graph/InMemorySymbolGraph'
import type { EmbeddingAdapter } from '../embeddings/EmbeddingAdapter'

export type ReviewDepth = 'fast' | 'standard' | 'deep'

export interface RetrieverConfig {
  /** Graph traversal depth: fast=1hop, standard=2hops (default), deep=2hops+embeddings */
  depth?: ReviewDepth
  /** Number of semantic neighbors to retrieve in deep mode */
  topK?: number
}

/**
 * Assembles a GraphReviewContext from a PR diff.
 *
 * Flow:
 * 1. Parse diff headers → extract changed file paths
 * 2. Find all symbols in those files from the in-memory graph
 * 3. BFS callers + callees from the graph
 * 4. (deep mode) vector-search for semantic neighbors
 * 5. Compute blast radius
 */
export class Retriever {
  constructor(
    private readonly graph: InMemorySymbolGraph,
    private readonly embeddings: EmbeddingAdapter | null = null,
    private readonly config: RetrieverConfig = {},
  ) {}

  async getReviewContext(diff: string, repoId: string): Promise<GraphReviewContext> {
    const depth = this.config.depth ?? 'standard'
    const hops = depth === 'fast' ? 1 : 2
    const topK = this.config.topK ?? 10

    // 1. Extract changed file paths from diff
    const changedFiles = extractChangedFiles(diff)

    // 2. Find changed symbols (all symbols in changed files)
    const allSymbols = this.graph.getAllSymbols()
    const changedSymbols = allSymbols.filter(s => changedFiles.has(s.filePath))

    // 3. BFS callers + callees
    const callerMap = new Map<string, ParsedSymbol>()
    const calleeMap = new Map<string, ParsedSymbol>()

    for (const sym of changedSymbols) {
      for (const c of this.graph.getCallers(sym.id, hops)) {
        callerMap.set(c.id, c)
      }
      for (const c of this.graph.getCallees(sym.id, 1)) {
        calleeMap.set(c.id, c)
      }
    }

    // Remove changed symbols from callers/callees to avoid duplicates
    const changedIds = new Set(changedSymbols.map(s => s.id))
    for (const id of changedIds) {
      callerMap.delete(id)
      calleeMap.delete(id)
    }

    // 4. Semantic neighbors (deep mode only)
    let semanticNeighbors: ParsedSymbol[] = []
    if (depth === 'deep' && this.embeddings && changedSymbols.length > 0) {
      const texts = changedSymbols.map(s =>
        `${s.signature}${s.docComment ? ' ' + s.docComment : ''}`
      )
      const embeddings = await this.embeddings.embed(texts)
      // Average the embeddings for multi-symbol queries
      const queryVector = averageVectors(embeddings)
      const results = await this.embeddings.search(queryVector, repoId, topK)

      // Filter out symbols already in caller/callee sets
      const knownIds = new Set([...changedIds, ...callerMap.keys(), ...calleeMap.keys()])
      for (const r of results) {
        if (!knownIds.has(r.id)) {
          const sym = this.graph.getSymbol(r.id)
          if (sym) semanticNeighbors.push(sym)
        }
      }
    }

    // 5. Blast radius
    const blastRadius = this.graph.getBlastRadius(changedSymbols.map(s => s.id))

    return {
      changedSymbols,
      callers: [...callerMap.values()],
      callees: [...calleeMap.values()],
      blastRadius,
      semanticNeighbors,
    }
  }
}

/** Parse unified diff headers to extract changed file paths. */
function extractChangedFiles(diff: string): Set<string> {
  const files = new Set<string>()
  // Match "--- a/path" or "+++ b/path" or "diff --git a/path b/path"
  const patterns = [
    /^--- a\/(.+)$/,
    /^\+\+\+ b\/(.+)$/,
    /^diff --git a\/.+ b\/(.+)$/,
  ]
  for (const line of diff.split('\n')) {
    for (const pattern of patterns) {
      const m = line.match(pattern)
      if (m) {
        const filePath = m[1].trim()
        if (filePath !== '/dev/null') files.add(filePath)
      }
    }
  }
  return files
}

function averageVectors(vecs: number[][]): number[] {
  if (vecs.length === 0) return []
  const dim = vecs[0].length
  const avg = new Array<number>(dim).fill(0)
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) {
      avg[i] += v[i]
    }
  }
  for (let i = 0; i < dim; i++) avg[i] /= vecs.length
  return avg
}
