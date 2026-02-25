# Three Depths of Review: Fast, Standard, and Deep Mode

*Part 4 of 7 in the "Building AgnusAI" series*

---

One of the earliest design decisions in AgnusAI that turned out to matter more than expected: not all code reviews need the same depth of analysis.

When a developer pushes a 2-line typo fix, running a full semantic embedding search over the entire codebase to find related symbols is overkill — and slow. When a developer changes a core authentication function, a 1-hop BFS that finds only direct callers might miss important transitive effects. The right analysis depth depends on the change.

We built three review depths into the system — Fast, Standard, and Deep — each representing a different tradeoff between cost, latency, and thoroughness. This post explains how they work, when to use each one, and the technical decisions behind them.

---

## The Depth Problem

More graph context = better review quality. But graph context has a cost:

- **Token cost.** Every symbol added to the `## Codebase Context` section of the prompt consumes tokens. At 2-hop depth on a large codebase, the context section can easily add 2,000–5,000 tokens to the prompt. At deep mode with semantic neighbors, it can be more. That's real money at API pricing, and real latency for local models.

- **Signal-to-noise.** More context isn't always more useful. If you inject 50 transitive callers into the prompt, the LLM has to reason about all of them. Some of them may be so loosely related that including them adds noise rather than signal.

- **Latency.** Vector search requires embedding the changed symbols and running a pgvector query. That's a roundtrip to the embedding model (local or API) plus a Postgres query. For a small PR, this overhead may not be worth it.

The design goal: match the depth of analysis to the nature of the change.

---

## Fast Mode: 1-Hop BFS

Fast mode does a single hop from each changed symbol in both directions — direct callers and direct callees.

In `packages/core/src/retriever/Retriever.ts`:

```typescript
const depth = this.config.depth ?? 'standard';
const hops = depth === 'fast' ? 1 : 2;

for (const sym of changedSymbols) {
  for (const c of this.graph.getCallers(sym.id, hops)) {
    callerMap.set(c.id, c);
  }
  for (const c of this.graph.getCallees(sym.id, 1)) {
    calleeMap.set(c.id, c);
  }
}
```

With `hops = 1`, you get the immediate call graph neighborhood: functions that directly call the changed code, and functions the changed code directly calls.

**When to use it:** Small PRs with isolated changes. Documentation updates, configuration changes, test-only changes, UI tweaks. Anything where you're confident the change is scoped to a single module with few external dependencies.

**Latency:** Near-instant. BFS at 1 hop on even large codebases completes in milliseconds. No embedding calls.

**Limitation:** Misses cascading effects. If `A` calls `B` (changed) and `C` calls `A`, fast mode finds `A` but misses `C`.

---

## Standard Mode: 2-Hop BFS

Standard mode is the default. It extends the BFS to two hops, catching both direct and transitive callers.

```typescript
const hops = 2; // for both 'standard' and 'deep'

// getBlastRadius computes 1-hop and 2-hop separately
getBlastRadius(ids: string[]): BlastRadius {
  for (const id of ids) {
    const direct = this.getCallers(id, 1);   // 1 hop
    const all = this.getCallers(id, 2);       // 2 hops
    const transitive = all.filter(s => !direct.find(d => d.id === s.id));
    // ...
  }
}
```

The `BlastRadius` type distinguishes direct and transitive callers:

```typescript
export interface BlastRadius {
  directCallers: ParsedSymbol[]      // 1 hop
  transitiveCallers: ParsedSymbol[]  // 2 hops
  affectedFiles: string[]
  riskScore: number                  // 0-100
}
```

This distinction matters for prompt quality. In the serialized graph context, callers are labeled: "These symbols depend on what was changed. If the change is breaking, they will be affected." The LLM can reason about transitive effects without the prompt explicitly explaining BFS — it just sees a list of functions that are downstream of the change.

**When to use it:** The right default for 80% of PRs. Any change to shared utility code, API handlers, data models, or anything with more than a handful of callers. The 2-hop window catches most real blast radius issues without overwhelming the LLM with irrelevant context.

**Latency:** Still fast — BFS at 2 hops adds minimal compute. No embedding calls.

[Image]: {Three concentric circle diagrams side by side on dark background. Labeled "Fast", "Standard", "Deep" in monospace text above each. Fast: single orange center node, one gray ring with 3 nodes. Standard: orange center, 2 gray rings with 3 and 8 nodes respectively. Deep: orange center, 2 gray rings, plus scattered dashed-outline nodes outside the rings labeled "semantic neighbors", connected to the outer ring with purple dashed lines. Legend: "hop 1", "hop 2", "semantic (embedding)" in orange, gray, and purple. All on #131312 background.}

---

## Deep Mode: 2-Hop BFS + pgvector Semantic Search

Deep mode adds a third layer on top of the 2-hop BFS: semantic similarity search using embeddings stored in pgvector.

After the BFS retrieves structural neighbors (callers and callees), deep mode embeds the changed symbols and queries the vector store for functions that are semantically similar — even if there's no direct call relationship between them.

```typescript
// packages/core/src/retriever/Retriever.ts
if (depth === 'deep' && this.embeddings && changedSymbols.length > 0) {
  const texts = changedSymbols.map(s =>
    `${s.signature}${s.docComment ? ' ' + s.docComment : ''}`
  );
  const embeddings = await this.embeddings.embed(texts);
  const queryVector = averageVectors(embeddings);  // average for multi-symbol queries
  const results = await this.embeddings.search(queryVector, repoId, topK);

  // Filter out symbols already in caller/callee sets
  const knownIds = new Set([...changedIds, ...callerMap.keys(), ...calleeMap.keys()]);
  for (const r of results) {
    if (!knownIds.has(r.id)) {
      const sym = this.graph.getSymbol(r.id);
      if (sym) semanticNeighbors.push(sym);
    }
  }
}
```

The semantic neighbors are surfaced in the prompt as a distinct section:

```
### Semantically related symbols
- `validateEmailFormat` (function): `validateEmailFormat(email: string): boolean`
- `checkEmailDomain` (function): `checkEmailDomain(domain: string): Promise<boolean>`
```

**Why this catches real issues:** Imagine you change `sanitizeUserInput()` — a function that validates and cleans user-provided strings. BFS finds its direct callers. But there might be a separate `sanitizeAdminInput()` function that implements similar logic independently. No call relationship between them — BFS can't find it. But they're semantically similar: same purpose, similar signatures. Deep mode surfaces the second function, letting the reviewer (human or AI) notice that a security fix in one might need to be mirrored in the other.

**When to use it:** High-risk changes. Auth logic. Payment processing. Data migrations. Anything where a missed related function could have security or correctness consequences.

**Latency:** Higher — requires one embedding API call (or local model call) plus a pgvector query. For Ollama-backed deployments on modest hardware, this might add 500ms–2s to the review time. For OpenAI embeddings, it's faster but costs money.

---

## pgvector: Why Postgres Beats a Dedicated Vector DB

Deep mode requires a vector store. We initially planned to use Qdrant — a purpose-built vector database with good performance and an excellent API.

We discarded it. The reason: we already depend on Postgres.

The `pgvector` extension adds a `vector` column type and cosine similarity search to Postgres with a single `CREATE EXTENSION IF NOT EXISTS vector`. The query syntax is clean:

```sql
SELECT symbol_id
FROM symbol_embeddings
WHERE repo_id = $1
ORDER BY embedding <=> $2
LIMIT 10;
```

The `<=>` operator is cosine distance. `ORDER BY embedding <=> $query_vector LIMIT K` returns the K nearest neighbors. That's the entire vector search API.

The embeddings live in a `symbol_embeddings` table:

```sql
CREATE TABLE symbol_embeddings (
  symbol_id TEXT NOT NULL,
  repo_id   TEXT NOT NULL,
  branch    TEXT NOT NULL,
  embedding vector(1536),  -- OpenAI/Ollama embedding dimension
  PRIMARY KEY (symbol_id, repo_id, branch)
);
```

The embedding dimension is 1536 for OpenAI's `text-embedding-3-small` and compatible Ollama models. For models with different dimensions, the column definition changes — but the query is identical.

**Operational benefit:** One service instead of two. Our `docker-compose.yml` has Postgres and Ollama. No Qdrant container, no Qdrant configuration, no Qdrant client library. The user installs AgnusAI with `docker compose up --build` and gets vector search included.

---

## Embedding Providers

The embedding pipeline uses the same adapter pattern as the LLM backends:

```typescript
export interface EmbeddingAdapter {
  embed(texts: string[]): Promise<number[][]>
  search(vector: number[], repoId: string, topK: number): Promise<Array<{ id: string }>>
  upsert(symbolId: string, repoId: string, branch: string, vector: number[]): Promise<void>
}
```

Four implementations: `OllamaEmbeddingAdapter`, `OpenAIEmbeddingAdapter`, `GoogleEmbeddingAdapter`, and `HttpEmbeddingAdapter` (for Cohere, Voyage, and other compatible APIs). Selected via the `EMBEDDING_PROVIDER` environment variable.

The `HttpEmbeddingAdapter` is worth noting: it accepts a generic endpoint URL and request format, making it compatible with any embedding API that follows OpenAI's request/response shape. Teams running their own embedding server (e.g., a Sentence Transformers endpoint) can plug it in with two env vars.

---

## Incremental Reviews: Not Re-Reviewing Everything on Every Push

One more depth-related feature that doesn't fit neatly into Fast/Standard/Deep: incremental reviews.

When a developer pushes a small fixup commit to an existing PR, running the full review pipeline again is wasteful. The LLM will re-flag all the same issues in the unchanged files, creating duplicate comment noise.

The solution: checkpoint comments. After each successful review, `PRReviewAgent` creates a hidden comment on the GitHub PR that stores the review state:

```typescript
// packages/reviewer/src/review/checkpoint.ts
export const CHECKPOINT_MARKER = '<!-- AGNUSAI_CHECKPOINT';

// Checkpoint stored as base64-encoded JSON:
interface ReviewCheckpoint {
  sha: string           // HEAD SHA at time of review
  filesReviewed: string[]
  commentCount: number
  verdict: string
  timestamp: string
}
```

On the next push, `checkIncremental()` finds the checkpoint comment, compares the current HEAD SHA to the checkpoint SHA, and requests only the incremental diff (commits added since the checkpoint):

```typescript
async checkIncremental(prId: string | number): Promise<IncrementalCheckResult> {
  const comments = await github.getPRComments(prId);
  const found = findCheckpointComment(comments);

  if (!found) {
    return { isIncremental: false, reason: 'No checkpoint comment found' };
  }

  return {
    isIncremental: true,
    checkpoint: found.checkpoint,
    checkpointCommentId: found.comment.id
  };
}
```

For Azure DevOps, the same logic is implemented differently: the pull request iteration API's `$compareTo=latest.id - 1` parameter returns exactly the diff between the current and previous push, without needing to store any checkpoint state.

The result: a 10-line comment fix commit doesn't re-trigger a full PR review. The reviewer only sees what changed since the last checkpoint.

---

## Choosing the Right Depth

In practice, most teams will want Standard mode as the default (which it is) and selectively use Deep for high-risk file patterns. The configuration in `CLAUDE.md` captures the recommended approach:

- `fast` — quick scans, small PRs, style/docs changes
- `standard` — default for all PRs; catches most blast radius issues
- `deep` — auth changes, payment code, data migrations, anything security-critical

The review depth is configurable per-repo in the dashboard, and the CLI supports `--depth fast|standard|deep`.

---

## The Key Takeaway

Review depth is a tradeoff, not a setting to maximize. The temptation is to always run deep mode because more context sounds better. In practice, adding more context to the prompt adds cost, latency, and sometimes noise. Standard mode catches the vast majority of real issues without the overhead.

Deep mode is a targeted tool for high-risk changes. The pgvector integration makes it possible without adding a new service to the deployment. The embedding adapter pattern makes it flexible across local and cloud embedding providers.

---

*Previous: [The Graph Engine: Why We Chose Tree-sitter WASM ←](./03-graph-engine-tree-sitter.md)*
*Next: [Building the Hosted Service: Monorepo, Fastify, and the Dashboard →](./05-hosted-service-monorepo-fastify.md)*
