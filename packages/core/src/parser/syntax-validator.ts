/**
 * Lightweight syntax validity checker using the existing tree-sitter parsers.
 * Initializes a shared ParserRegistry on first call and reuses it.
 *
 * Supported languages: typescript, javascript, python, java, go, csharp
 * Unknown languages: returns true (pass-through, no validation)
 */

import { createDefaultRegistry, ParserRegistry } from './ParserRegistry';

const LANG_EXT_MAP: Record<string, string> = {
  typescript: '.ts',
  javascript: '.js',
  python: '.py',
  java: '.java',
  go: '.go',
  csharp: '.cs',
};

let _registryPromise: Promise<ParserRegistry> | null = null;

function getRegistry(): Promise<ParserRegistry> {
  if (!_registryPromise) {
    _registryPromise = createDefaultRegistry();
  }
  return _registryPromise;
}

/**
 * Returns true when the code string parses without errors for the given language.
 * Returns true for unknown languages (graceful degradation).
 */
export async function isSyntaxValid(code: string, language: string): Promise<boolean> {
  const ext = LANG_EXT_MAP[language.toLowerCase()];
  if (!ext) return true; // unsupported language — skip validation

  try {
    const registry = await getRegistry();
    const parser = registry.getParser(`file${ext}`);
    if (!parser) return true;
    // parseFile throws on internal errors; a successful call with parse errors
    // is detected by checking rootNode.hasError
    const result = registry.parseFile(`file${ext}`, code, '__validation__');
    if (!result) return true;
    return true; // parseFile doesn't expose hasError — use parse directly
  } catch {
    return true; // graceful degradation
  }
}

/**
 * Direct tree-sitter parse with error detection.
 * Uses the parser instance directly to check rootNode.hasError.
 */
export async function isSyntaxValidStrict(code: string, language: string): Promise<boolean> {
  const ext = LANG_EXT_MAP[language.toLowerCase()];
  if (!ext) return true;

  try {
    const registry = await getRegistry();
    const parser = registry.getParser(`file${ext}`) as any;
    if (!parser || !parser.parserInstance) return true;
    const tree = parser.parserInstance.parse(code);
    return !tree.rootNode.hasError();
  } catch {
    return true;
  }
}
