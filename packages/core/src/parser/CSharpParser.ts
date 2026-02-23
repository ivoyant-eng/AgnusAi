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
    walkNode(tree.rootNode, filePath, repoId, symbols, edges, null)
    return { symbols, edges }
  }
}

function walkNode(
  node: SyntaxNode,
  filePath: string,
  repoId: string,
  symbols: ParsedSymbol[],
  edges: Edge[],
  classCtx: string | null,
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
            walkNode(child, filePath, repoId, symbols, edges, qn)
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
        symbols.push({
          id: makeSymbolId(filePath, qn), filePath, name, qualifiedName: qn,
          kind: 'method', signature: sig,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractCalls(node, makeSymbolId(filePath, qn), edges)
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
        symbols.push({
          id: makeSymbolId(filePath, qn), filePath, name, qualifiedName: qn,
          kind: 'method', signature: sig,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractCalls(node, makeSymbolId(filePath, qn), edges)
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
      walkNode(child, filePath, repoId, symbols, edges, classCtx)
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
