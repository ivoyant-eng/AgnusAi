# Graph Engine

`InMemorySymbolGraph` is the core data structure. It holds every symbol and edge in the repo in RAM and answers BFS queries in microseconds.

## Data Model

### ParsedSymbol

```typescript
interface ParsedSymbol {
  id: string              // "src/auth/service.ts:AuthService.login"
  filePath: string        // "src/auth/service.ts"
  name: string            // "login"
  qualifiedName: string   // "AuthService.login"
  kind: SymbolKind        // 'function' | 'class' | 'method' | 'interface' | 'const' | 'type'
  signature: string       // "login(credentials: Credentials): Promise<User>"
  bodyRange: [number, number]  // [startLine, endLine]
  docComment?: string
  repoId: string
}
```

### Edge

```typescript
interface Edge {
  from: string   // symbol id
  to: string     // symbol id or bare name (resolved at query time)
  kind: EdgeKind // 'calls' | 'imports' | 'inherits' | 'implements' | 'uses' | 'overrides'
}
```

### BlastRadius

```typescript
interface BlastRadius {
  directCallers: ParsedSymbol[]      // 1 hop inbound
  transitiveCallers: ParsedSymbol[]  // 2 hops inbound
  affectedFiles: string[]            // deduplicated file list
  riskScore: number                  // 0–100
}
```

## Adjacency List

The graph stores two maps:

```
inEdges:  symbolId → Edge[]   (who calls this symbol)
outEdges: symbolId → Edge[]   (who this symbol calls)
nameToIds: bare_name → symbolId[]  (resolves "login" → "service.ts:AuthService.login")
```

The `nameToIds` index is critical: Tree-sitter captures call expressions as bare callee names (e.g. `createClient`), not qualified IDs. Without this index, BFS would never find callers through call edges.

## BFS Traversal

`getCallers(id, hops)` walks `inEdges` breadth-first up to `hops` levels:

```
hops=1 → direct callers only
hops=2 → direct callers + their callers (standard/deep mode)
```

`getCallees(id, hops)` walks `outEdges` the same way.

## Risk Score Formula

```
score = min(100, directCallers.length * 10 + affectedFiles.length * 5)
```

A symbol called from 5 different files (5 × 10 = 50) with 8 affected files (8 × 5 = 40) gets a score of 90 — high risk.

## Snapshot Persistence

On every full or incremental index, the graph is serialized to JSON and stored in the `graph_snapshots` table. On server restart, the snapshot is deserialized back into memory — no need to re-parse the entire repo.

```sql
CREATE TABLE graph_snapshots (
  repo_id TEXT PRIMARY KEY,
  snapshot TEXT NOT NULL,   -- full JSON serialization
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Incremental Updates

When a push arrives with changed files:

1. `graph.removeFile(filePath)` — removes all symbols and edges for that file, cleans `nameToIds`
2. `storage.deleteByFile(filePath, repoId)` — removes from Postgres
3. Re-parse the file → add new symbols/edges → upsert to Postgres
4. If embeddings enabled → re-embed changed symbols only
5. Save new snapshot

Unchanged files are never touched.
