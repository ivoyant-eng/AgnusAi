# Roadmap: Symbol-Level `uses` Edges Across All Languages

## Problem

All five parsers (TypeScript, Python, Java, Go, C#) currently emit `imports` edges as:

```
{ from: 'src/auth/service.ts', to: '@/config', kind: 'imports' }
```

The `from` field is a **file path**, not a symbol ID. `InMemorySymbolGraph` BFS starts from symbol IDs, so these edges are completely invisible to `getCallers()` / `getCallees()`. As a result:

- Any symbol found by embedding search that has no `calls` edge to the changed code always gets `graphDistance = 3` (the sentinel "structurally distant" value) even if it genuinely depends on it via an import.
- The graph-distance re-ranking formula `similarity × (1 / (dist + 1))` is applied to a mostly flat pool — most semantic neighbor candidates are at distance=3, so the formula reduces to pure cosine similarity ranking.
- **The 8/10 improvement from graph-distance re-ranking is mostly unrealised until this is fixed.**

---

## Goal

Emit symbol-level `uses` edges so that:

```
// Before
{ from: 'src/auth/service.ts', to: '@/config', kind: 'imports' }

// After — per symbol that actually uses the import
{ from: 'src/auth/service.ts:TokenService.verify', to: 'AppConfig', kind: 'uses' }
```

Which `InMemorySymbolGraph` resolves through `nameToIds` to:
```
inEdges['src/config/index.ts:AppConfig'] gets the edge from TokenService.verify
```

BFS from `AppConfig` then finds `TokenService.verify` at **distance=1** instead of distance=3.

---

## Implementation Plan

### Files to change

| File | Change |
|------|--------|
| `packages/core/src/parser/TypeScriptParser.ts` | Collect named imports, scan symbol bodies for usage |
| `packages/core/src/parser/PythonParser.ts` | Same |
| `packages/core/src/parser/JavaParser.ts` | Same |
| `packages/core/src/parser/GoParser.ts` | Same + handle `pkg.Symbol` selector pattern |
| `packages/core/src/parser/CSharpParser.ts` | Same (namespace-level only, lower signal) |
| `packages/core/src/graph/InMemorySymbolGraph.ts` | Extend `addEdge` to resolve `uses` edges through `nameToIds` |

---

### Step 1 — Extend `InMemorySymbolGraph` (one line)

In `addEdge`, extend the `resolveCallTarget` logic to also apply to `uses` edges:

```typescript
// packages/core/src/graph/InMemorySymbolGraph.ts

// Before:
const toKeys = e.kind === 'calls' ? this.resolveCallTarget(e.to) : [e.to]

// After:
const toKeys = (e.kind === 'calls' || e.kind === 'uses')
  ? this.resolveCallTarget(e.to)
  : [e.to]
```

`resolveCallTarget` already handles bare-name → full symbol ID resolution via `nameToIds`. This makes `uses` edges work identically to `calls` edges in BFS.

---

### Step 2 — Shared helper (new file or inline in each parser)

Each parser needs two new functions following the same pattern:

#### `collectImportedNames(root: SyntaxNode): Set<string>`

Pre-scan the file's top-level nodes for import statements. Extract the **local names** that this file will use — not the module path.

#### `extractUses(node, fromId, importedNames, seen, edges)`

Walk a symbol's body. When an `identifier` node matches a name in `importedNames`, emit a `uses` edge. `seen: Set<string>` deduplicates — only one edge per `(fromId, name)` pair.

```typescript
function extractUses(
  node: SyntaxNode,
  fromId: string,
  importedNames: Set<string>,
  seen: Set<string>,
  edges: Edge[],
): void {
  if (node.type === 'identifier' && importedNames.has(node.text)) {
    const key = `${fromId}::${node.text}`
    if (!seen.has(key)) {
      seen.add(key)
      edges.push({ from: fromId, to: node.text, kind: 'uses' })
    }
  }
  for (const child of node.namedChildren) {
    extractUses(child, fromId, importedNames, seen, edges)
  }
}
```

---

### Step 3 — Per-language named import extraction

#### TypeScript / JavaScript

AST node: `import_statement`

```typescript
// import { AppConfig, DB } from '@/config'
// import DefaultExport from './module'
// import * as Ns from './ns'
// import type { TokenPayload } from './types'  ← same structure

function collectImportedNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  for (const node of root.namedChildren) {
    if (node.type !== 'import_statement') continue
    for (const child of node.namedChildren) {
      if (child.type === 'import_clause') {
        // default import: import Foo from '...'
        const defaultId = child.namedChildren.find(c => c.type === 'identifier')
        if (defaultId) names.add(defaultId.text)

        // named imports: import { A, B as C } from '...'
        const namedImports = child.namedChildren.find(c => c.type === 'named_imports')
        if (namedImports) {
          for (const spec of namedImports.namedChildren) {
            if (spec.type === 'import_specifier') {
              // alias takes precedence: import { Foo as Bar } → local name is Bar
              const alias = spec.childForFieldName('alias')
              const name = spec.childForFieldName('name')
              const localName = alias ?? name
              if (localName) names.add(localName.text)
            }
          }
        }

        // namespace import: import * as Ns from '...'
        const nsImport = child.namedChildren.find(c => c.type === 'namespace_import')
        if (nsImport) {
          const id = nsImport.namedChildren.find(c => c.type === 'identifier')
          if (id) names.add(id.text)
        }
      }
    }
  }
  return names
}
```

**Precision:** High. Named imports are explicit in the AST.

---

#### Python

AST nodes: `import_statement` and `import_from_statement`

```typescript
function collectImportedNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  for (const node of root.namedChildren) {
    // from auth.service import TokenService, AuthError
    if (node.type === 'import_from_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' || child.type === 'identifier') {
          // skip the module name (first dotted_name) — only collect imported names
          // tree-sitter-python puts imported names after 'import' keyword
        }
        if (child.type === 'aliased_import') {
          const alias = child.childForFieldName('alias')
          if (alias) names.add(alias.text)
        }
      }
      // namedChildren after 'import' keyword node are the imported names
      const importKw = node.children.findIndex(c => c.type === 'import')
      if (importKw !== -1) {
        for (let i = importKw + 1; i < node.namedChildren.length; i++) {
          const c = node.namedChildren[i]
          if (c.type === 'dotted_name' || c.type === 'identifier') names.add(c.text.split('.').pop()!)
          if (c.type === 'aliased_import') {
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
```

**Precision:** High for `from x import y` (the common case). Low for bare `import os` (stdlib — adds noise but no false edges since `os` won't be a graph symbol).

---

#### Java

AST node: `import_declaration`

```typescript
function collectImportedNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  for (const node of root.namedChildren) {
    if (node.type !== 'import_declaration') continue
    const id = node.namedChildren.find(c =>
      c.type === 'scoped_identifier' || c.type === 'identifier'
    )
    if (!id) continue
    const text = id.text
    // Skip wildcard imports: com.example.*
    if (text.endsWith('.*')) continue
    // Extract last segment: com.example.auth.TokenService → TokenService
    const lastSegment = text.split('.').pop()!
    names.add(lastSegment)
  }
  return names
}
```

**Precision:** High for specific imports. Wildcard imports (`import com.example.*`) are skipped — acceptable tradeoff.

---

#### Go

Go imports give the package path, not specific symbol names. Usage is via `packageName.SymbolName` selector expressions.

Two-part approach:

**Part A:** Collect imported package aliases from import declarations:
```typescript
function collectImportedPackages(root: SyntaxNode): Map<string, string> {
  // Returns Map<localAlias, importPath>
  const pkgs = new Map<string, string>()
  for (const node of root.namedChildren) {
    if (node.type === 'import_declaration') {
      for (const spec of node.namedChildren) {
        if (spec.type === 'import_spec') {
          const pathNode = spec.childForFieldName('path')
            ?? spec.namedChildren.find(c => c.type === 'interpreted_string_literal')
          if (!pathNode) continue
          const importPath = pathNode.text.replace(/['"]/g, '')
          // Explicit alias: import myauth "github.com/company/auth"
          const alias = spec.namedChildren.find(c => c.type === 'identifier' || c.type === 'blank_identifier')
          const pkgName = alias?.text ?? importPath.split('/').pop()!
          if (pkgName !== '_' && pkgName !== '.') pkgs.set(pkgName, importPath)
        }
      }
    }
  }
  return pkgs
}
```

**Part B:** In `extractCalls`, when we encounter a `selector_expression` like `auth.Connect`, also check if `auth` is an imported package and emit a `uses` edge for the selector:
```typescript
// In extractCalls / a new extractGoUses:
if (node.type === 'selector_expression') {
  const operand = node.childForFieldName('operand')
  const field = node.childForFieldName('field')
  if (operand && field && importedPkgs.has(operand.text)) {
    // auth.Connect → emit uses edge to 'Connect' (resolves via nameToIds)
    edges.push({ from: fromId, to: field.text, kind: 'uses' })
  }
}
```

**Precision:** Medium-High. Package selectors are unambiguous; resolution via `nameToIds` handles the rest.

---

#### C#

AST node: `using_directive`

```typescript
function collectImportedNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  for (const node of root.namedChildren) {
    if (node.type !== 'using_directive') continue
    // Aliased using: using TokenSvc = Company.Auth.TokenService
    // Tree-sitter C# represents this as a name_equals + qualified_name
    const nameEquals = node.namedChildren.find(c => c.type === 'name_equals')
    if (nameEquals) {
      const id = nameEquals.namedChildren.find(c => c.type === 'identifier')
      if (id) names.add(id.text)
      continue
    }
    // Plain namespace import: using System.Collections.Generic
    // Low signal — last segment rarely matches a specific symbol name
    // Include anyway: noise is harmless (nameToIds lookup returns empty)
    const qname = node.namedChildren.find(c =>
      c.type === 'qualified_name' || c.type === 'identifier'
    )
    if (qname) names.add(qname.text.split('.').pop()!)
  }
  return names
}
```

**Precision:** Low-Medium. Aliased usings (`using TokenSvc = ...`) are precise. Plain namespace usings (`using System.Collections.Generic`) add the last segment which rarely matches a graph symbol — harmless noise.

---

### Step 4 — Wire up in each parser's `parseFile`

Same pattern for all 5 parsers:

```typescript
parseFile(filePath: string, content: string, repoId: string): ParseResult {
  const tree = this.parserInstance.parse(content)
  const symbols: ParsedSymbol[] = []
  const edges: Edge[] = []

  // Pre-scan: collect names imported by this file
  const importedNames = collectImportedNames(tree.rootNode)

  // Main walk: symbols, calls, inherits — pass importedNames through
  walkNode(tree.rootNode, filePath, repoId, symbols, edges, null, importedNames)
  return { symbols, edges }
}
```

Inside `walkNode`, after each symbol is registered and before returning, call `extractUses`:

```typescript
// Example: inside function_declaration case in TypeScriptParser
symbols.push({ id: symId, ... })
extractCalls(node, symId, edges)             // existing
extractUses(node, symId, importedNames, new Set(), edges)  // new
```

---

## Expected Impact

| Before | After |
|--------|-------|
| Imported symbols always at `graphDistance = 3` | Imported symbols at `graphDistance = 1` or `2` |
| Re-ranking formula has no effect on most results | Re-ranking meaningfully separates structural vs. coincidental matches |
| Semantic neighbors are pure cosine similarity | Semantic neighbors favour structurally connected symbols |

For a PR changing `TokenService.verify` that imports `AppConfig`:
- **Before:** `AppConfig` found by embedding search → distance=3 → combined score ≈ 0.25 × similarity
- **After:** `AppConfig` at distance=1 → combined score ≈ 0.50 × similarity → ranks above coincidentally similar but unrelated symbols

**Estimated overall impact on review quality: 8/10** — this fixes the root cause that limits the graph-distance re-ranking to a 3/10 improvement today.

---

## Limitations and Non-Goals

- **No module resolution.** `@/config`, `github.com/company/auth`, `com.example.*` are not resolved to file paths. Resolution happens at the name level via `nameToIds`. This means if two files define `AppConfig`, both get the `uses` edge — acceptable over-approximation for a code reviewer.
- **No wildcard Java imports** (`import com.example.*`). These are skipped.
- **No C# `using static`** directives. Static imports (`using static Math`) are a future extension.
- **No dynamic imports** (`import()` in TS, `importlib` in Python). Out of scope.
- **Local variables shadow imports.** If a function declares `const AppConfig = ...`, its body scanning will still emit a `uses` edge. This is a false positive but harmless — it slightly over-connects in rare cases.

---

## Dependencies

- No new packages required.
- `uses` is already a valid `EdgeKind` in `packages/shared/src/types.ts`.
- One-line change to `InMemorySymbolGraph` is backward compatible — existing `calls`/`inherits`/`implements` edges are unaffected.
- Parser changes are additive — existing `imports` file-level edges remain for backward compatibility.

---

## Commit Plan (when implementing)

1. `feat(core): resolve uses edges through nameToIds in InMemorySymbolGraph`
2. `feat(core/parser): emit symbol-level uses edges in TypeScriptParser`
3. `feat(core/parser): emit symbol-level uses edges in PythonParser`
4. `feat(core/parser): emit symbol-level uses edges in JavaParser`
5. `feat(core/parser): emit symbol-level uses edges in GoParser (selector-based)`
6. `feat(core/parser): emit symbol-level uses edges in CSharpParser`
