import path from 'path'
import type { LanguageParser, ParseResult } from './LanguageParser'

export class ParserRegistry {
  private parsers: LanguageParser[] = []
  private extMap = new Map<string, LanguageParser>()

  register(parser: LanguageParser): void {
    this.parsers.push(parser)
    for (const ext of parser.extensions) {
      this.extMap.set(ext, parser)
    }
  }

  getParser(filePath: string): LanguageParser | null {
    const ext = path.extname(filePath).toLowerCase()
    return this.extMap.get(ext) ?? null
  }

  parseFile(filePath: string, content: string, repoId: string): ParseResult | null {
    const parser = this.getParser(filePath)
    if (!parser) return null
    return parser.parseFile(filePath, content, repoId)
  }

  /** Initialize all registered parsers. Call once on startup. */
  async initAll(): Promise<void> {
    await Promise.all(this.parsers.map(p => p.init()))
  }
}

/** Build a registry with all supported language parsers. */
export async function createDefaultRegistry(): Promise<ParserRegistry> {
  const registry = new ParserRegistry()

  // Import all parsers up front (dynamic to avoid crashing at module load time)
  const { TypeScriptParser } = await import('./TypeScriptParser')
  const { PythonParser } = await import('./PythonParser')
  const { JavaParser } = await import('./JavaParser')
  const { GoParser } = await import('./GoParser')
  const { CSharpParser } = await import('./CSharpParser')

  const candidates: LanguageParser[] = [
    new TypeScriptParser(),
    new PythonParser(),
    new JavaParser(),
    new GoParser(),
    new CSharpParser(),
  ]

  // Initialize ALL parsers concurrently — web-tree-sitter requires this because
  // Parser.init() boots the shared WASM runtime once; all parsers must await it
  // together so Parser.Language is available when each grammar WASM is loaded.
  // Per-parser try/catch isolates ABI mismatches (e.g. Go ABI 15 vs runtime ABI 14)
  // without preventing the other parsers from loading.
  await Promise.all(candidates.map(async (p) => {
    try {
      await p.init()
      registry.register(p)
    } catch (err) {
      console.warn(`[ParserRegistry] Skipping ${p.constructor.name} — init failed: ${(err as Error).message}`)
    }
  }))

  return registry
}
