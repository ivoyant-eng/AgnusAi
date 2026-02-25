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

In addition to the 2-hop graph context, the Retriever embeds the changed symbols' signatures and searches the vector store for the top 10 semantically similar symbols. Results are **re-ranked** by combining embedding similarity with inverse graph distance — symbols structurally closer to the changed code rank higher even if a slightly more distant symbol has a marginally better embedding match. These **semantic neighbors** are injected into the prompt even if they have no graph edge to the changed code — useful for finding similar patterns, naming conventions, and potential duplicate implementations.

::: warning Deep mode requires embeddings
If `REVIEW_DEPTH=deep` but `EMBEDDING_PROVIDER` is not set, the reviewer falls back to 2-hop graph only (same as standard).
:::

## Prior Examples (Feedback Learning Loop)

Across all modes, if `EMBEDDING_PROVIDER` is configured and developers have previously rated comments, two sets of examples are retrieved in a single embedding call and injected into the prompt:

**Positive examples** — top-5 accepted (👍) comments, injected as `## Examples of feedback your team found helpful`. The LLM uses these as style guidance, matching the depth and focus areas the team has endorsed.

**Negative examples** — top-3 rejected (👎) comments, injected as `## Examples of feedback this team found NOT helpful`. The LLM is explicitly told to avoid comment patterns the team has dismissed.

```
## Examples of feedback your team found helpful
...

## Examples of feedback this team found NOT helpful
Avoid writing comments similar to these — developers on this repo have explicitly marked them as unhelpful.

---
[src/utils/helpers.ts]
**Suggestion:** Consider renaming this variable for clarity. [Confidence: 0.51]
```

Every 👍/👎 rating strengthens the learning loop. Comments are scoped per `repo_id` so cross-repo contamination is not possible.

::: tip No ratings yet?
Both example sections are silently skipped on the first reviews. The system starts learning as soon as one rated comment exists.
:::

## Precision Filter

The LLM is required to self-assess a confidence score for every comment it generates. Scores are extracted from the response and low-confidence comments are automatically dropped before posting.

### How it works

The LLM appends `[Confidence: X.X]` to each comment body. The reviewer parser extracts the score and strips it from the displayed comment. Any comment below the threshold (default `0.7`) is silently filtered out.

```
LLM output:          The token is not validated before use. [Confidence: 0.92]
Displayed comment:   The token is not validated before use.
Filtered out:        This could potentially be improved. [Confidence: 0.45]
```

### Scoring guide

| Range | Meaning |
|-------|---------|
| 0.9–1.0 | Definite bug, security issue, or clear correctness problem |
| 0.7–0.9 | Likely issue with clear impact |
| 0.5–0.7 | Potential issue, may be stylistic |
| 0.0–0.5 | Speculative — model is told to omit these entirely |

### Configuration

Set `PRECISION_THRESHOLD` in `.env` to adjust the cutoff:

```env
PRECISION_THRESHOLD=0.8   # stricter — only post very confident findings
PRECISION_THRESHOLD=0.5   # looser — include more potential issues
```

Default is `0.7`. Applied in both full reviews and incremental reviews.

::: tip Comments without a confidence score
If a comment does not include `[Confidence: X.X]` (e.g. from an older model or skill), it is kept regardless of threshold — backward compatible.
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
