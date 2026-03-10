import path from 'path'
import Parser from 'web-tree-sitter'
import type { ParsedSymbol, Edge } from '@agnus-ai/shared'
import type { ParseResult } from './LanguageParser'
import { TreeSitterParser, makeSymbolId, initWasm } from './TreeSitterParser'

type SyntaxNode = Parser.SyntaxNode

function getWasmPath(): string {
  const pkgDir = path.dirname(require.resolve('tree-sitter-python/package.json'))
  return path.join(pkgDir, 'tree-sitter-python.wasm')
}

export class PythonParser extends TreeSitterParser {
  extensions = ['.py']

  async init(): Promise<void> {
    if (this.parserInstance) return
    await initWasm()
    const lang = await Parser.Language.load(getWasmPath())
    this.parserInstance = new Parser()
    this.parserInstance.setLanguage(lang)
  }

  parseFile(filePath: string, content: string, repoId: string): ParseResult {
    if (!this.parserInstance) throw new Error('PythonParser not initialized — call init() first')
    const tree = this.parserInstance.parse(content)
    const symbols: ParsedSymbol[] = []
    const edges: Edge[] = []
    const importedNames = collectImportedNames(tree.rootNode)
    walkNode(tree.rootNode, filePath, repoId, symbols, edges, null, importedNames)
    return { symbols, edges }
  }
}

/** Collect locally-bound names from Python import statements. */
function collectImportedNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  for (const node of root.namedChildren) {
    // from auth.service import TokenService, AuthError
    if (node.type === 'import_from_statement') {
      const importKwIdx = node.children.findIndex(c => c.type === 'import')
      if (importKwIdx !== -1) {
        for (let i = importKwIdx + 1; i < node.namedChildren.length; i++) {
          const c = node.namedChildren[i]
          if (c.type === 'dotted_name' || c.type === 'identifier') {
            names.add(c.text.split('.').pop()!)
          } else if (c.type === 'aliased_import') {
            const alias = c.childForFieldName('alias') ?? c.childForFieldName('name')
            if (alias) names.add(alias.text)
          }
        }
      }
    }
    // import os  /  import os as operating_system
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name') names.add(child.text.split('.').pop()!)
        if (child.type === 'aliased_import') {
          const alias = child.childForFieldName('alias') ?? child.childForFieldName('name')
          if (alias) names.add(alias.text)
        }
      }
    }
  }
  return names
}

function extractUses(
  node: SyntaxNode,
  fromId: string,
  importedNames: Set<string>,
  seen: Set<string>,
  edges: Edge[],
): void {
  if (node.type === 'identifier' && importedNames.has(node.text)) {
    const key = `${fromId}::${node.text}`
    if (!seen.has(key)) { seen.add(key); edges.push({ from: fromId, to: node.text, kind: 'uses' }) }
  }
  for (const child of node.namedChildren) extractUses(child, fromId, importedNames, seen, edges)
}

function walkNode(
  node: SyntaxNode,
  filePath: string,
  repoId: string,
  symbols: ParsedSymbol[],
  edges: Edge[],
  classCtx: string | null,
  importedNames: Set<string> = new Set(),
): void {
  switch (node.type) {
    case 'class_definition': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        const superclasses = node.childForFieldName('superclasses')
        if (superclasses) {
          for (const arg of superclasses.namedChildren) {
            edges.push({ from: makeSymbolId(filePath, qn), to: arg.text, kind: 'inherits' })
          }
        }
        symbols.push({
          id: makeSymbolId(filePath, qn), filePath, name, qualifiedName: qn,
          kind: 'class', signature: `class ${name}`,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        const body = node.childForFieldName('body')
        if (body) {
          for (const c of body.namedChildren) {
            walkNode(c, filePath, repoId, symbols, edges, qn, importedNames)
          }
        }
        return
      }
      break
    }

    case 'function_definition': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        const params = node.childForFieldName('parameters')
        const retType = node.childForFieldName('return_type')
        const isAsync = node.parent?.type === 'decorated_definition'
          ? false
          : node.children.some(c => c.type === 'async')
        const prefix = isAsync ? 'async def' : 'def'
        const sig = `${prefix} ${name}${params ? params.text : '()'}${retType ? ` -> ${retType.text}` : ''}`
        const kind = classCtx ? 'method' : 'function'
        const symId = makeSymbolId(filePath, qn)
        symbols.push({
          id: symId, filePath, name, qualifiedName: qn,
          kind, signature: sig,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractPyCalls(node, symId, edges)
        extractUses(node, symId, importedNames, new Set(), edges)
        return
      }
      break
    }

    case 'decorated_definition': {
      const inner = node.namedChildren.find(c =>
        c.type === 'function_definition' || c.type === 'class_definition'
      )
      if (inner) {
        walkNode(inner, filePath, repoId, symbols, edges, classCtx, importedNames)
        return
      }
      break
    }

    case 'import_statement': {
      for (const c of node.namedChildren) {
        if (c.type === 'dotted_name') {
          edges.push({ from: filePath, to: c.text, kind: 'imports' })
        } else if (c.type === 'aliased_import') {
          const modName = c.childForFieldName('name')
          if (modName) edges.push({ from: filePath, to: modName.text, kind: 'imports' })
        }
      }
      break
    }

    case 'import_from_statement': {
      const module = node.childForFieldName('module_name')
      if (module) {
        edges.push({ from: filePath, to: module.text, kind: 'imports' })
      }
      break
    }
  }

  if (node.type !== 'class_definition' &&
    node.type !== 'function_definition' &&
    node.type !== 'decorated_definition') {
    for (const child of node.namedChildren) {
      walkNode(child, filePath, repoId, symbols, edges, classCtx, importedNames)
    }
  }
}

function extractPyCalls(node: SyntaxNode, fromId: string, edges: Edge[]): void {
  if (node.type === 'call') {
    const fn = node.childForFieldName('function')
    if (fn) {
      const callee = fn.type === 'attribute'
        ? fn.childForFieldName('attribute')?.text ?? fn.text
        : fn.text
      if (callee) edges.push({ from: fromId, to: callee, kind: 'calls' })
    }
  }
  for (const child of node.namedChildren) {
    extractPyCalls(child, fromId, edges)
  }
}
