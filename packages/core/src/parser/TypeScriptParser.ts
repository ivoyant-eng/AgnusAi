import path from 'path'
import Parser from 'web-tree-sitter'
import type { ParsedSymbol, Edge } from '@agnus-ai/shared'
import type { ParseResult } from './LanguageParser'
import { TreeSitterParser, makeSymbolId, initWasm } from './TreeSitterParser'

type SyntaxNode = Parser.SyntaxNode

function getWasmPath(): string {
  const pkgDir = path.dirname(require.resolve('tree-sitter-typescript/package.json'))
  return path.join(pkgDir, 'tree-sitter-typescript.wasm')
}

export class TypeScriptParser extends TreeSitterParser {
  extensions = ['.ts', '.tsx', '.js', '.jsx']

  async init(): Promise<void> {
    if (this.parserInstance) return
    await initWasm()
    const lang = await Parser.Language.load(getWasmPath())
    this.parserInstance = new Parser()
    this.parserInstance.setLanguage(lang)
  }

  parseFile(filePath: string, content: string, repoId: string): ParseResult {
    if (!this.parserInstance) throw new Error('TypeScriptParser not initialized — call init() first')
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
    case 'abstract_class_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        // Heritage edges
        for (const child of node.namedChildren) {
          if (child.type === 'class_heritage') {
            for (const clause of child.namedChildren) {
              const kind = clause.type === 'extends_clause' ? 'inherits' : 'implements'
              for (const typeRef of clause.namedChildren) {
                if (typeRef.type !== 'extends' && typeRef.type !== 'implements') {
                  edges.push({ from: makeSymbolId(filePath, qn), to: typeRef.text, kind })
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
          for (const c of body.namedChildren) {
            walkNode(c, filePath, repoId, symbols, edges, qn)
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

    case 'function_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        const params = node.childForFieldName('parameters')
        const retType = node.childForFieldName('return_type')
        const sig = `function ${name}${params ? params.text : '()'}${retType ? `: ${retType.text}` : ''}`
        symbols.push({
          id: makeSymbolId(filePath, qn), filePath, name, qualifiedName: qn,
          kind: 'function', signature: sig,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractCalls(node, makeSymbolId(filePath, qn), edges)
        return
      }
      break
    }

    case 'method_definition': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        const params = node.childForFieldName('parameters')
        const retType = node.childForFieldName('return_type')
        const sig = `${name}${params ? params.text : '()'}${retType ? `: ${retType.text}` : ''}`
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

    case 'type_alias_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        symbols.push({
          id: makeSymbolId(filePath, qn), filePath, name, qualifiedName: qn,
          kind: 'type', signature: `type ${name}`,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
      }
      break
    }

    case 'lexical_declaration':
    case 'variable_declaration': {
      // const/let foo = (...) => ...
      for (const declarator of node.namedChildren) {
        if (declarator.type === 'variable_declarator') {
          const nameNode = declarator.childForFieldName('name')
          const valueNode = declarator.childForFieldName('value')
          if (nameNode && valueNode &&
            (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
            const name = nameNode.text
            const qn = classCtx ? `${classCtx}.${name}` : name
            const params = valueNode.childForFieldName('parameters')
            const retType = valueNode.childForFieldName('return_type')
            const sig = `const ${name} = ${params ? params.text : '()'}${retType ? `: ${retType.text}` : ''} =>`
            symbols.push({
              id: makeSymbolId(filePath, qn), filePath, name, qualifiedName: qn,
              kind: 'function', signature: sig,
              bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
              repoId,
            })
            extractCalls(valueNode, makeSymbolId(filePath, qn), edges)
          }
        }
      }
      break
    }

    case 'import_statement': {
      const source = node.childForFieldName('source')
      if (source) {
        edges.push({ from: filePath, to: source.text.replace(/['"]/g, ''), kind: 'imports' })
      }
      break
    }
  }

  // Default recursion for unhandled node types
  if (node.type !== 'class_declaration' &&
    node.type !== 'abstract_class_declaration' &&
    node.type !== 'function_declaration' &&
    node.type !== 'method_definition') {
    for (const child of node.namedChildren) {
      walkNode(child, filePath, repoId, symbols, edges, classCtx)
    }
  }
}

function extractCalls(node: SyntaxNode, fromId: string, edges: Edge[]): void {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn) {
      const callee = fn.type === 'member_expression'
        ? fn.childForFieldName('property')?.text ?? fn.text
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
