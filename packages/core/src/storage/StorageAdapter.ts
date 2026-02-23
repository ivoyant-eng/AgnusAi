import type { ParsedSymbol, Edge } from '@agnus-ai/shared'

export interface StorageAdapter {
  saveSymbols(symbols: ParsedSymbol[], branch: string): Promise<void>
  saveEdges(edges: Edge[], branch: string): Promise<void>
  deleteByFile(filePath: string, repoId: string, branch: string): Promise<void>
  deleteAllForBranch(repoId: string, branch: string): Promise<void>
  loadAll(repoId: string, branch: string): Promise<{ symbols: ParsedSymbol[]; edges: Edge[] }>
  saveGraphSnapshot(repoId: string, branch: string, json: string): Promise<void>
  loadGraphSnapshot(repoId: string, branch: string): Promise<string | null>
}
