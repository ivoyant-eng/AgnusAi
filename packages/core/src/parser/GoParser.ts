import path from 'path'
import Parser from 'web-tree-sitter'
import type { ParsedSymbol, Edge } from '@agnus-ai/shared'
import type { ParseResult } from './LanguageParser'
import { TreeSitterParser, makeSymbolId, initWasm } from './TreeSitterParser'

type SyntaxNode = Parser.SyntaxNode

function getWasmPath(): string {
  const pkgDir = path.dirname(require.resolve('tree-sitter-go/package.json'))
  return path.join(pkgDir, 'tree-sitter-go.wasm')
}

export class GoParser extends TreeSitterParser {
  extensions = ['.go']

  async init(): Promise<void> {
    if (this.parserInstance) return
    await initWasm()
    const lang = await Parser.Language.load(getWasmPath())
    this.parserInstance = new Parser()
    this.parserInstance.setLanguage(lang)
  }

  parseFile(filePath: string, content: string, repoId: string): ParseResult {
    if (!this.parserInstance) throw new Error('GoParser not initialized — call init() first')
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
  typeCtx: string | null,
): void {
  switch (node.type) {
    case 'function_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const params = node.childForFieldName('parameters')
        const result = node.childForFieldName('result')
        const sig = `func ${name}${params ? params.text : '()'}${result ? ' ' + result.text : ''}`
        symbols.push({
          id: makeSymbolId(filePath, name), filePath, name, qualifiedName: name,
          kind: 'function', signature: sig,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractCalls(node, makeSymbolId(filePath, name), edges)
        return
      }
      break
    }

    case 'method_declaration': {
      const nameNode = node.childForFieldName('name')
      const receiverNode = node.childForFieldName('receiver')
      if (nameNode) {
        const name = nameNode.text
        // Extract receiver type name for qualified name
        let receiverType = ''
        if (receiverNode) {
          for (const child of receiverNode.namedChildren) {
            const typeNode = child.childForFieldName('type')
            if (typeNode) {
              receiverType = typeNode.text.replace('*', '')
              break
            }
          }
        }
        const qn = receiverType ? `${receiverType}.${name}` : name
        const params = node.childForFieldName('parameters')
        const result = node.childForFieldName('result')
        const sig = `func (${receiverNode?.text ?? ''}) ${name}${params ? params.text : '()'}${result ? ' ' + result.text : ''}`
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

    case 'type_declaration': {
      for (const child of node.namedChildren) {
        if (child.type === 'type_spec') {
          const nameNode = child.childForFieldName('name')
          const typeNode = child.childForFieldName('type')
          if (nameNode) {
            const name = nameNode.text
            const isInterface = typeNode?.type === 'interface_type'
            const isStruct = typeNode?.type === 'struct_type'
            const kind = isInterface ? 'interface' : isStruct ? 'class' : 'type'
            symbols.push({
              id: makeSymbolId(filePath, name), filePath, name, qualifiedName: name,
              kind, signature: `type ${name} ${typeNode?.type ?? ''}`,
              bodyRange: [child.startPosition.row + 1, child.endPosition.row + 1],
              repoId,
            })
          }
        }
      }
      break
    }

    case 'import_declaration':
    case 'import_spec': {
      const pathNode = node.childForFieldName('path') ?? node.namedChildren.find(c => c.type === 'interpreted_string_literal')
      if (pathNode) {
        edges.push({ from: filePath, to: pathNode.text.replace(/['"]/g, ''), kind: 'imports' })
      }
      break
    }
  }

  // Default recursion
  if (node.type !== 'function_declaration' && node.type !== 'method_declaration') {
    for (const child of node.namedChildren) {
      walkNode(child, filePath, repoId, symbols, edges, typeCtx)
    }
  }
}

function extractCalls(node: SyntaxNode, fromId: string, edges: Edge[]): void {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn) {
      const callee = fn.type === 'selector_expression'
        ? fn.childForFieldName('field')?.text ?? fn.text
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
