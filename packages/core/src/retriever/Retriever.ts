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
      // Fetch 3× topK candidates so the knownIds filter + re-ranking has enough
      // material to fill the final topK slots. Without this, filtering BFS-known
      // symbols from a topK-sized result set often leaves fewer than topK neighbors.
      const results = await this.embeddings.search(queryVector, repoId, topK * 3)

      // Re-rank: combine embedding similarity with inverse graph distance
      // score from search is already cosine similarity (higher = more similar)
      const knownIds = new Set([...changedIds, ...callerMap.keys(), ...calleeMap.keys()])
      const ranked = results
        .filter(r => !knownIds.has(r.id))
        .map(r => {
          const graphDist = computeMinGraphDistance(r.id, changedIds, this.graph)
          const combinedScore = r.score * (1 / (graphDist + 1))
          return { id: r.id, combinedScore }
        })
        .sort((a, b) => b.combinedScore - a.combinedScore)
        .slice(0, topK)

      for (const { id } of ranked) {
        const sym = this.graph.getSymbol(id)
        if (sym) semanticNeighbors.push(sym)
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

/**
 * BFS from each changed symbol (callers + callees) to find the minimum graph
 * distance from `symbolId` to any changed symbol. Returns 1, 2, or 3 (capped).
 */
function computeMinGraphDistance(
  symbolId: string,
  changedIds: Set<string>,
  graph: InMemorySymbolGraph,
  maxHops = 2,
): number {
  for (const changedId of changedIds) {
    // Distance 1: direct caller or callee of a changed symbol
    const hop1 = [...graph.getCallers(changedId, 1), ...graph.getCallees(changedId, 1)]
    if (hop1.some(s => s.id === symbolId)) return 1
    // Distance 2: within 2-hop BFS (getCallers/getCallees return all within N hops)
    if (maxHops >= 2) {
      const hop2 = [...graph.getCallers(changedId, 2), ...graph.getCallees(changedId, 2)]
      if (hop2.some(s => s.id === symbolId)) return 2
    }
  }
  return maxHops + 1 // structurally distant
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
