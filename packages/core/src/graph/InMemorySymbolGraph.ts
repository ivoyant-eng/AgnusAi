import type { ParsedSymbol, Edge, BlastRadius } from '@agnus-ai/shared'

export class InMemorySymbolGraph {
  private symbols = new Map<string, ParsedSymbol>()
  /** outEdges[id] = edges where `from === id` */
  private outEdges = new Map<string, Edge[]>()
  /** inEdges[id] = edges where `to === id` (keyed by full symbol ID) */
  private inEdges = new Map<string, Edge[]>()
  /** fileToSymbols[filePath] = symbol ids */
  private fileToSymbols = new Map<string, Set<string>>()
  /** nameToIds[name] = [full symbol id, ...] — for resolving bare call names */
  private nameToIds = new Map<string, string[]>()

  addSymbol(s: ParsedSymbol): void {
    this.symbols.set(s.id, s)
    if (!this.fileToSymbols.has(s.filePath)) {
      this.fileToSymbols.set(s.filePath, new Set())
    }
    this.fileToSymbols.get(s.filePath)!.add(s.id)
    // Index by short name for call edge resolution
    if (!this.nameToIds.has(s.name)) this.nameToIds.set(s.name, [])
    this.nameToIds.get(s.name)!.push(s.id)
  }

  addEdge(e: Edge): void {
    if (!this.outEdges.has(e.from)) this.outEdges.set(e.from, [])
    this.outEdges.get(e.from)!.push(e)
    // For call edges the `to` is often a bare name (e.g. "cn") not a full ID.
    // Resolve it to all matching full symbol IDs so callers BFS works correctly.
    const toKeys = e.kind === 'calls' ? this.resolveCallTarget(e.to) : [e.to]
    for (const key of toKeys) {
      if (!this.inEdges.has(key)) this.inEdges.set(key, [])
      this.inEdges.get(key)!.push(e)
    }
  }

  /**
   * Resolve a call target to one or more full symbol IDs.
   * If `name` already looks like a full ID (contains ':'), use it as-is.
   * Otherwise look up the name index; fall back to the raw name if unresolved.
   */
  private resolveCallTarget(name: string): string[] {
    if (name.includes(':')) return [name]
    const ids = this.nameToIds.get(name)
    return ids && ids.length > 0 ? ids : [name]
  }

  /** Remove all symbols and edges for a file (call before re-indexing it). */
  removeFile(filePath: string): void {
    const ids = this.fileToSymbols.get(filePath)
    if (!ids) return
    for (const id of ids) {
      const sym = this.symbols.get(id)
      this.symbols.delete(id)
      // Remove from name index
      if (sym) {
        const nameIds = this.nameToIds.get(sym.name)
        if (nameIds) {
          const filtered = nameIds.filter(i => i !== id)
          if (filtered.length === 0) this.nameToIds.delete(sym.name)
          else this.nameToIds.set(sym.name, filtered)
        }
      }
      // Remove outgoing edges from this symbol
      const outs = this.outEdges.get(id) ?? []
      for (const e of outs) {
        // Remove from all inEdges keys this edge was indexed under
        for (const key of this.resolveCallTarget(e.to)) {
          const ins = this.inEdges.get(key)
          if (ins) {
            const filtered = ins.filter(i => i.from !== id)
            if (filtered.length === 0) this.inEdges.delete(key)
            else this.inEdges.set(key, filtered)
          }
        }
      }
      this.outEdges.delete(id)
      // Remove incoming edges to this symbol (keyed by this symbol's id)
      const ins = this.inEdges.get(id) ?? []
      for (const e of ins) {
        const outs2 = this.outEdges.get(e.from)
        if (outs2) {
          this.outEdges.set(e.from, outs2.filter(o => o.to !== e.to))
        }
      }
      this.inEdges.delete(id)
    }
    this.fileToSymbols.delete(filePath)
  }

  getSymbol(id: string): ParsedSymbol | undefined {
    return this.symbols.get(id)
  }

  getAllSymbols(): ParsedSymbol[] {
    return Array.from(this.symbols.values())
  }

  getAllEdges(): Edge[] {
    const edges: Edge[] = []
    for (const outs of this.outEdges.values()) {
      edges.push(...outs)
    }
    return edges
  }

  /**
   * Get callers of `id` up to `hops` levels.
   * Default 2 hops (direct + transitive callers).
   */
  getCallers(id: string, hops = 2): ParsedSymbol[] {
    const visited = new Set<string>()
    const result: ParsedSymbol[] = []
    this.bfs(id, hops, this.inEdges, visited, result)
    return result
  }

  /**
   * Get callees of `id` up to `hops` levels.
   * Default 1 hop.
   */
  getCallees(id: string, hops = 1): ParsedSymbol[] {
    const visited = new Set<string>()
    const result: ParsedSymbol[] = []
    this.bfs(id, hops, this.outEdges, visited, result)
    return result
  }

  private bfs(
    startId: string,
    maxHops: number,
    edgeMap: Map<string, Edge[]>,
    visited: Set<string>,
    result: ParsedSymbol[],
  ): void {
    const queue: Array<{ id: string; hop: number }> = [{ id: startId, hop: 0 }]
    visited.add(startId)
    while (queue.length > 0) {
      const { id, hop } = queue.shift()!
      if (hop >= maxHops) continue
      const edges = edgeMap.get(id) ?? []
      for (const e of edges) {
        const neighborId = edgeMap === this.inEdges ? e.from : e.to
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        const sym = this.symbols.get(neighborId)
        if (sym) {
          result.push(sym)
          queue.push({ id: neighborId, hop: hop + 1 })
        }
      }
    }
  }

  /** Compute blast radius for a set of changed symbol ids. */
  getBlastRadius(ids: string[]): BlastRadius {
    const direct = new Map<string, ParsedSymbol>()
    const transitive = new Map<string, ParsedSymbol>()

    for (const id of ids) {
      // Direct callers (1 hop)
      const d = this.getCallers(id, 1)
      for (const s of d) direct.set(s.id, s)
      // Transitive callers (2 hops) minus direct
      const t = this.getCallers(id, 2)
      for (const s of t) {
        if (!direct.has(s.id)) transitive.set(s.id, s)
      }
    }

    const allCallers = [...direct.values(), ...transitive.values()]
    const affectedFiles = [...new Set([
      ...ids.map(id => this.symbols.get(id)?.filePath).filter(Boolean) as string[],
      ...allCallers.map(s => s.filePath),
    ])]

    // Risk score: 0-100 based on caller count + transitivity
    const riskScore = Math.min(100, Math.round(
      (direct.size * 10 + transitive.size * 5) *
      (affectedFiles.length > 5 ? 1.5 : 1)
    ))

    return {
      directCallers: [...direct.values()],
      transitiveCallers: [...transitive.values()],
      affectedFiles,
      riskScore,
    }
  }

  serialize(): string {
    return JSON.stringify({
      symbols: Array.from(this.symbols.values()),
      edges: this.getAllEdges(),
    })
  }

  static deserialize(json: string): InMemorySymbolGraph {
    const g = new InMemorySymbolGraph()
    const data = JSON.parse(json) as { symbols: ParsedSymbol[]; edges: Edge[] }
    for (const s of data.symbols) g.addSymbol(s)
    for (const e of data.edges) g.addEdge(e)
    return g
  }
}
