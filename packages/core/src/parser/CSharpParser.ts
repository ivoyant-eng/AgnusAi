import path from 'path'
import Parser from 'web-tree-sitter'
import type { ParsedSymbol, Edge } from '@agnus-ai/shared'
import type { ParseResult } from './LanguageParser'
import { TreeSitterParser, makeSymbolId, initWasm } from './TreeSitterParser'

type SyntaxNode = Parser.SyntaxNode

function getWasmPath(): string {
  const pkgDir = path.dirname(require.resolve('tree-sitter-c-sharp/package.json'))
  return path.join(pkgDir, 'tree-sitter-c_sharp.wasm')
}

export class CSharpParser extends TreeSitterParser {
  extensions = ['.cs']

  async init(): Promise<void> {
    if (this.parserInstance) return
    await initWasm()
    const lang = await Parser.Language.load(getWasmPath())
    this.parserInstance = new Parser()
    this.parserInstance.setLanguage(lang)
  }

  parseFile(filePath: string, content: string, repoId: string): ParseResult {
    if (!this.parserInstance) throw new Error('CSharpParser not initialized — call init() first')
    const tree = this.parserInstance.parse(content)
    const symbols: ParsedSymbol[] = []
    const edges: Edge[] = []
    const importedNames = collectImportedNames(tree.rootNode)
    walkNode(tree.rootNode, filePath, repoId, symbols, edges, null, importedNames)
    return { symbols, edges }
  }
}

/** Collect locally-bound names from C# using directives. */
function collectImportedNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  function visit(n: SyntaxNode): void {
    if (n.type === 'using_directive') {
      // using Alias = Some.Type; — the alias identifier is the local name
      const alias = n.namedChildren.find(c => c.type === 'name_equals')
      if (alias) {
        const id = alias.namedChildren.find(c => c.type === 'identifier')
        if (id) { names.add(id.text); return }
      }
      // using System.Collections.Generic; — last segment is the local name
      const ns = n.namedChildren.find(c => c.type === 'identifier' || c.type === 'qualified_name')
      if (ns) names.add(ns.text.split('.').pop()!)
    }
    for (const child of n.namedChildren) visit(child)
  }
  visit(root)
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
    case 'class_declaration':
    case 'record_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        // Inheritance edges
        const bases = node.childForFieldName('bases')
        if (bases) {
          for (const base of bases.namedChildren) {
            if (base.type === 'base_list') {
              for (const type of base.namedChildren) {
                if (type.type !== ',') {
                  edges.push({ from: makeSymbolId(filePath, qn), to: type.text, kind: 'inherits' })
                }
              }
            }
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
          for (const child of body.namedChildren) {
            walkNode(child, filePath, repoId, symbols, edges, qn, importedNames)
          }
        }
        return
      }
      break
    }

    case 'interface_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        symbols.push({
          id: makeSymbolId(filePath, qn), filePath, name, qualifiedName: qn,
          kind: 'interface', signature: `interface ${name}`,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
      }
      break
    }

    case 'method_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        const params = node.childForFieldName('parameters')
        const returnType = node.childForFieldName('type')
        const sig = `${returnType ? returnType.text + ' ' : ''}${name}${params ? params.text : '()'}`
        const symId = makeSymbolId(filePath, qn)
        symbols.push({
          id: symId, filePath, name, qualifiedName: qn,
          kind: 'method', signature: sig,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractCalls(node, symId, edges)
        extractUses(node, symId, importedNames, new Set(), edges)
        return
      }
      break
    }

    case 'constructor_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        const params = node.childForFieldName('parameters')
        const sig = `${name}${params ? params.text : '()'}`
        const symId = makeSymbolId(filePath, qn)
        symbols.push({
          id: symId, filePath, name, qualifiedName: qn,
          kind: 'method', signature: sig,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractCalls(node, symId, edges)
        extractUses(node, symId, importedNames, new Set(), edges)
        return
      }
      break
    }

    case 'using_directive': {
      // using System.Collections.Generic;
      const ns = node.namedChildren.find(c => c.type === 'identifier' || c.type === 'qualified_name')
      if (ns) {
        edges.push({ from: filePath, to: ns.text, kind: 'imports' })
      }
      break
    }
  }

  // Default recursion (skip already-handled node types that recurse themselves)
  if (node.type !== 'class_declaration' &&
    node.type !== 'record_declaration' &&
    node.type !== 'method_declaration' &&
    node.type !== 'constructor_declaration') {
    for (const child of node.namedChildren) {
      walkNode(child, filePath, repoId, symbols, edges, classCtx, importedNames)
    }
  }
}

function extractCalls(node: SyntaxNode, fromId: string, edges: Edge[]): void {
  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function')
    if (fn) {
      const callee = fn.type === 'member_access_expression'
        ? fn.childForFieldName('name')?.text ?? fn.text
        : fn.text
      if (callee) {
        edges.push({ from: fromId, to: callee, kind: 'calls' })
      }
    }
  }
  for (const child of node.namedChildren) {
    extractCalls(child, fromId, edges)
  }
}
