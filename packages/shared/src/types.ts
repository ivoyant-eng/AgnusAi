export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'const' | 'type'
export type EdgeKind = 'calls' | 'imports' | 'inherits' | 'implements' | 'uses' | 'overrides'

export interface ParsedSymbol {
  id: string              // "src/auth/service.ts:AuthService.login"
  filePath: string
  name: string
  qualifiedName: string   // "AuthService.login"
  kind: SymbolKind
  signature: string       // "login(credentials: Credentials): Promise<User>"
  bodyRange: [number, number]
  docComment?: string
  repoId: string
}

export interface Edge {
  from: string            // symbol id
  to: string              // symbol id
  kind: EdgeKind
}

export interface BlastRadius {
  directCallers: ParsedSymbol[]      // 1 hop
  transitiveCallers: ParsedSymbol[]  // 2 hops
  affectedFiles: string[]
  riskScore: number                  // 0-100
}

export interface GraphReviewContext {
  changedSymbols: ParsedSymbol[]
  callers: ParsedSymbol[]
  callees: ParsedSymbol[]
  blastRadius: BlastRadius
  semanticNeighbors: ParsedSymbol[]
  priorExamples?: string[]
  rejectedExamples?: string[]
}

export interface IndexProgress {
  step: 'parsing' | 'embedding' | 'done' | 'error'
  file?: string
  progress?: number
  total?: number
  symbolCount?: number
  edgeCount?: number
  durationMs?: number
  message?: string
}

export interface IndexStats {
  symbolCount: number
  edgeCount: number
  fileCount: number
  durationMs: number
}
