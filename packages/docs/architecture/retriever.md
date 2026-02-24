# Retriever & RAG

The `Retriever` assembles a `GraphReviewContext` from a PR diff. It combines graph traversal, (in deep mode) vector search, and prior feedback examples to give the LLM the richest possible context.

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
  semanticNeighbors: ParsedSymbol[]   // top-K re-ranked by embedding + graph distance (deep mode)
  priorExamples?: string[]            // top-5 accepted comments from past reviews (RAG)
  rejectedExamples?: string[]         // top-3 rejected comments from past reviews (negative RAG)
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

### 4. Semantic Search + Graph-Distance Re-ranking (deep mode only)

The signatures of changed symbols are averaged into a single query vector and searched against `symbol_embeddings`:

```sql
SELECT symbol_id, 1 - (embedding <=> $1::vector) AS score
FROM symbol_embeddings
WHERE repo_id = $2
ORDER BY embedding <=> $1::vector
LIMIT 10
```

Results are then **re-ranked** by combining embedding similarity with inverse graph distance:

```
combinedScore = embeddingSimilarity × (1 / (graphDistance + 1))
```

`graphDistance` is the minimum hop count from any changed symbol (callers + callees BFS), capped at 3 if no structural connection exists within 2 hops. This means a direct callee with high similarity scores identically to a 4-hop neighbour with high similarity — the structurally closer symbol ranks higher.

Results already in the caller/callee sets are deduplicated before re-ranking.

### 5. Blast Radius

`graph.getBlastRadius(changedSymbolIds)` computes:
- All direct callers
- All transitive callers
- Deduplicated affected file list
- Risk score (0–100)

### 6. Prior Examples (feedback RAG)

This step runs in `review-runner`, not inside `Retriever` itself, but produces the `priorExamples` field on `GraphReviewContext`.

The first 8,000 characters of the diff are embedded and compared against all `review_comments` that:
- Belong to the same `repo_id`
- Have been marked `accepted` in `review_feedback`
- Have a stored embedding vector

```sql
SELECT rc.body, rc.path
FROM review_comments rc
JOIN review_feedback rf ON rf.comment_id = rc.id
WHERE rc.repo_id = $1
  AND rf.signal = 'accepted'
  AND rc.embedding IS NOT NULL
ORDER BY rc.embedding <-> $2   -- pgvector cosine distance
LIMIT 5
```

The top-5 accepted results are cleaned (UI feedback links stripped) and injected into the prompt as a `## Examples of feedback your team found helpful` section. The LLM uses these as style guidance — matching the depth, tone, and focus areas that the team has already endorsed.

In the same embedding call, the top-3 **rejected** comments (marked 👎 by developers) are also retrieved and injected as a separate `## Examples of feedback this team found NOT helpful` section. This negative signal steers the LLM away from comment patterns the team has explicitly dismissed.

::: tip Graceful degradation
If `EMBEDDING_PROVIDER` is not set, or no rated comments exist yet, both steps are silently skipped. Reviews work normally without them.
:::

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
