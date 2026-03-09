import path from 'path'
import Parser from 'web-tree-sitter'
import type { ParsedSymbol, Edge } from '@agnus-ai/shared'
import type { ParseResult } from './LanguageParser'
import { TreeSitterParser, makeSymbolId, initWasm } from './TreeSitterParser'

type SyntaxNode = Parser.SyntaxNode

function getWasmPath(): string {
  const pkgDir = path.dirname(require.resolve('tree-sitter-java/package.json'))
  return path.join(pkgDir, 'tree-sitter-java.wasm')
}

export class JavaParser extends TreeSitterParser {
  extensions = ['.java']

  async init(): Promise<void> {
    if (this.parserInstance) return
    await initWasm()
    const lang = await Parser.Language.load(getWasmPath())
    this.parserInstance = new Parser()
    this.parserInstance.setLanguage(lang)
  }

  parseFile(filePath: string, content: string, repoId: string): ParseResult {
    if (!this.parserInstance) throw new Error('JavaParser not initialized — call init() first')
    const tree = this.parserInstance.parse(content)
    const symbols: ParsedSymbol[] = []
    const edges: Edge[] = []
    const importedNames = collectImportedNames(tree.rootNode)
    walkNode(tree.rootNode, filePath, repoId, symbols, edges, null, importedNames)
    return { symbols, edges }
  }
}

/** Collect locally-bound simple names from Java import statements. */
function collectImportedNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  for (const node of root.namedChildren) {
    if (node.type !== 'import_declaration') continue
    const id = node.namedChildren.find(c => c.type === 'scoped_identifier' || c.type === 'identifier')
    if (!id) continue
    const text = id.text
    // Skip wildcards: import com.example.*
    if (text.endsWith('.*')) continue
    names.add(text.split('.').pop()!)
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
    case 'class_declaration': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const name = nameNode.text
        const qn = classCtx ? `${classCtx}.${name}` : name
        const superclass = node.childForFieldName('superclass')
        if (superclass) {
          edges.push({ from: makeSymbolId(filePath, qn), to: superclass.text, kind: 'inherits' })
        }
        const interfaces = node.childForFieldName('interfaces')
        if (interfaces) {
          for (const iface of interfaces.namedChildren) {
            if (iface.type === 'type_list') {
              for (const t of iface.namedChildren) {
                edges.push({ from: makeSymbolId(filePath, qn), to: t.text, kind: 'implements' })
              }
            } else if (iface.type !== ',') {
              edges.push({ from: makeSymbolId(filePath, qn), to: iface.text, kind: 'implements' })
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
            walkNode(c, filePath, repoId, symbols, edges, qn, importedNames)
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
        const retType = node.childForFieldName('type')
        const sig = `${retType ? retType.text + ' ' : ''}${name}${params ? params.text : '()'}`
        const symId = makeSymbolId(filePath, qn)
        symbols.push({
          id: symId, filePath, name, qualifiedName: qn,
          kind: classCtx ? 'method' : 'function', signature: sig,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractJavaCalls(node, symId, edges)
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
        const symId = makeSymbolId(filePath, qn)
        symbols.push({
          id: symId, filePath, name, qualifiedName: qn,
          kind: 'function', signature: `${name}${params ? params.text : '()'}`,
          bodyRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          repoId,
        })
        extractJavaCalls(node, symId, edges)
        extractUses(node, symId, importedNames, new Set(), edges)
        return
      }
      break
    }

    case 'import_declaration': {
      const identifier = node.namedChildren.find(c =>
        c.type === 'scoped_identifier' || c.type === 'identifier'
      )
      if (identifier) {
        edges.push({ from: filePath, to: identifier.text, kind: 'imports' })
      }
      break
    }
  }

  if (node.type !== 'class_declaration' &&
    node.type !== 'interface_declaration' &&
    node.type !== 'method_declaration' &&
    node.type !== 'constructor_declaration') {
    for (const child of node.namedChildren) {
      walkNode(child, filePath, repoId, symbols, edges, classCtx, importedNames)
    }
  }
}

function extractJavaCalls(node: SyntaxNode, fromId: string, edges: Edge[]): void {
  if (node.type === 'method_invocation') {
    const nameNode = node.childForFieldName('name')
    if (nameNode) {
      edges.push({ from: fromId, to: nameNode.text, kind: 'calls' })
    }
  }
  for (const child of node.namedChildren) {
    extractJavaCalls(child, fromId, edges)
  }
}
