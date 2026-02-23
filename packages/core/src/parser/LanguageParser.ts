import type { ParsedSymbol, Edge } from '@agnus-ai/shared'

export interface ParseResult {
  symbols: ParsedSymbol[]
  edges: Edge[]
}

export interface LanguageParser {
  /** File extensions this parser handles (e.g. ['.ts', '.tsx']) */
  extensions: string[]
  /** Initialize async resources (WASM loading). Must be called before parseFile(). */
  init(): Promise<void>
  parseFile(filePath: string, content: string, repoId: string): ParseResult
}
