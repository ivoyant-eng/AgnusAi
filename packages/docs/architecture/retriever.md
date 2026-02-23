# Retriever & RAG

The `Retriever` assembles a `GraphReviewContext` from a PR diff. It combines graph traversal and (in deep mode) vector search to give the LLM the richest possible context.

## Input / Output

```typescript
// Input: raw unified diff string
const ctx = await retriever.getReviewContext(diff, repoId)

// Output: GraphReviewContext
interface GraphReviewContext {
  changedSymbols: ParsedSymbol[]      // symbols in changed files
  callers: ParsedSymbol[]             // BFS inbound (1 or 2 hops)
  callees: ParsedSymbol[]             // BFS outbound (1 hop)
  blastRadius: BlastRadius            // score + affected files
  semanticNeighbors: ParsedSymbol[]   // top-K by embedding similarity (deep mode)
}
```

## Retrieval Steps

### 1. Parse Diff Headers

The diff is scanned for `--- a/path` and `+++ b/path` lines to extract which files changed. No file content is read — only the paths.

### 2. Find Changed Symbols

All symbols whose `filePath` matches a changed file are collected. These are the "entry points" for graph traversal.

### 3. Graph BFS

For each changed symbol:

- `graph.getCallers(id, hops)` — walks `inEdges` (who calls this code)
- `graph.getCallees(id, 1)` — walks `outEdges` 1 level (what this code calls)

Results are deduplicated across all changed symbols.

`hops` is determined by `REVIEW_DEPTH`:
- `fast` → 1
- `standard` / `deep` → 2

### 4. Semantic Search (deep mode only)

The signatures of changed symbols are embedded and searched against `symbol_embeddings`:

```sql
SELECT symbol_id, 1 - (embedding <=> $1::vector) AS score
FROM symbol_embeddings
WHERE repo_id = $2
ORDER BY embedding <=> $1::vector
LIMIT 10
```

The top 10 results are fetched from the graph and added as `semanticNeighbors`. Results that already appear in the graph traversal are deduplicated.

### 5. Blast Radius

`graph.getBlastRadius(changedSymbolIds)` computes:
- All direct callers
- All transitive callers
- Deduplicated affected file list
- Risk score (0–100)

## Prompt Serialization

`serializeForPrompt(ctx)` converts the context to markdown injected into the LLM prompt:

```markdown
## Codebase Context

### Changed Symbols
- `lib/supabase/supabaseClient.ts:createClient` — function createClient(): SupabaseClient

### Blast Radius  (risk score: 100/100)
Affected files: app/login/page.tsx, hooks/useAuth.ts, ...

### Direct Callers (1 hop)
- `app/login/page.tsx:GET` — GET(): Promise<Response>
...

### Transitive Callers (2 hops)
- `components/AuthGuard.tsx:AuthGuard` — AuthGuard({ children }: Props)

### Semantic Neighbors
- `lib/supabase/serverClient.ts:createServerClient` — createServerClient(): SupabaseClient
```

## Token Budget

The context is summarized, not verbatim:
- Changed symbols: full signature
- Direct callers: signature + inferred intent
- Transitive callers: signature only
- Semantic neighbors: signature only

This keeps the graph context section under ~500 tokens in most cases.
