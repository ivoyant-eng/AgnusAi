/**
 * Base class for web-tree-sitter language parsers.
 * Handles lazy WASM init so parsers can be instantiated synchronously
 * and initialized once via `init()`.
 */
import Parser from 'web-tree-sitter'
import type { ParsedSymbol, Edge } from '@agnus-ai/shared'
import type { LanguageParser, ParseResult } from './LanguageParser'

/**
 * web-tree-sitter's Parser.init() boots the WASM module once.
 * After the first call the function is consumed/removed from the object,
 * so every subsequent direct call throws "init is not a function".
 * This singleton ensures WASM is only booted once, regardless of how many
 * parsers are initialized (sequentially or in parallel).
 */
let _wasmInit: Promise<void> | null = null
export function initWasm(): Promise<void> {
  if (!_wasmInit) _wasmInit = Parser.init()
  return _wasmInit
}

export type SyntaxNode = Parser.SyntaxNode

export function makeSymbolId(filePath: string, qualifiedName: string): string {
  return `${filePath}:${qualifiedName}`
}

export abstract class TreeSitterParser implements LanguageParser {
  abstract extensions: string[]
  protected parserInstance: Parser | null = null

  abstract init(): Promise<void>
  abstract parseFile(filePath: string, content: string, repoId: string): ParseResult
}
