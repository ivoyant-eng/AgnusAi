# Review Modes

AgnusAI has three review depth modes. Set `REVIEW_DEPTH` in your `.env` to switch between them.

## Fast

```bash
REVIEW_DEPTH=fast
```

**Graph traversal:** 1 hop (direct callers and callees only)
**Embeddings:** Disabled
**Best for:** Quick feedback on small PRs, CI pipelines where speed matters

The diff is reviewed with 1-hop graph context. Changed symbols get their immediate callers/callees surfaced to the LLM, but transitive effects are not shown.

## Standard (default)

```bash
REVIEW_DEPTH=standard
```

**Graph traversal:** 2 hops
**Embeddings:** Disabled
**Best for:** Most PRs — catches the majority of blast radius without needing embeddings

The LLM sees changed symbols + all direct callers + transitive callers (2 hops). This is the sweet spot: token budget stays manageable and blast radius coverage is high.

## Deep

```bash
REVIEW_DEPTH=deep
```

**Graph traversal:** 2 hops
**Embeddings:** Required — `EMBEDDING_PROVIDER` must be set
**Best for:** High-risk PRs, architectural changes, utility function refactors

In addition to the 2-hop graph context, the Retriever embeds the changed symbols' signatures and searches the vector store for the top 10 semantically similar symbols. These **semantic neighbors** are injected into the prompt even if they have no graph edge to the changed code — useful for finding similar patterns, naming conventions, and potential duplicate implementations.

::: warning Deep mode requires embeddings
If `REVIEW_DEPTH=deep` but `EMBEDDING_PROVIDER` is not set, the reviewer falls back to 2-hop graph only (same as standard).
:::

## What the LLM Sees

In all modes, the prompt includes a `## Codebase Context` section when graph context is available:

```
## Codebase Context

### Changed Symbols
- `lib/supabase/supabaseClient.ts:createClient` — function createClient(): SupabaseClient

### Blast Radius  (risk score: 100/100)
Affected files: app/login/page.tsx, hooks/useAuth.ts, components/UserTracker.tsx, ...

### Direct Callers (1 hop)
- `app/login/page.tsx:GET` — GET(): Promise<Response>
- `hooks/useAuth.ts:signInWith` — signInWith(provider: Provider): Promise<void>

### Transitive Callers (2 hops)
- `components/AuthGuard.tsx:AuthGuard` — AuthGuard({ children }: Props)

### Semantic Neighbors  [deep mode only]
- `lib/supabase/serverClient.ts:createServerClient` — createServerClient(): SupabaseClient
```

## Risk Score

The blast radius risk score (0–100) is calculated from:

- Number of direct callers (each adds ~10 points)
- Number of affected files (each adds ~5 points)
- Capped at 100

A score of 100 means the changed symbol is called from many files — the LLM will be explicitly warned that this is a high-impact change.

## Choosing a Mode

| Scenario | Recommended mode |
|----------|-----------------|
| Simple bug fix, no callers | `fast` |
| Feature addition, moderate impact | `standard` |
| Utility function used everywhere | `deep` |
| Auth / database layer change | `deep` |
| Refactor of a widely-used interface | `deep` |
| CI pipeline review on every commit | `fast` or `standard` |
