# The Deduplication Problem Nobody Talks About in Multi-Agent AI

*Part 10 of the "Building Ryv" series*

---

[Image]: {Five identical robots standing around a whiteboard, each independently reaching for the same piece of chalk to write the same thing. One robot already holds the chalk — the others haven't noticed yet. The whiteboard shows the same file path written five times in slightly different handwriting. Clean editorial illustration, muted tones, one orange accent.}

When we shipped the multi-agent review architecture, we had five specialist agents running in parallel. Security. Correctness. Performance. Style. Blast radius. Each one wired up with its own SymbolExplorer instance — its own tool loop, its own LLM context, its own ability to call `read_file`, `get_symbol_body`, `find_callers`.

The reviews were better. Noticeably better. But something in the logs caught our eye.

```
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → 177 chars
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → 177 chars
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → 177 chars
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → 177 chars
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → 177 chars
```

Five agents. Five reads. Same file. Same result. Five times.

---

## The Obvious Problem

It sounds like a minor inefficiency. It isn't.

Every tool call in the review loop is synchronous — the agent halts, waits for the result, resumes. When five agents independently read the same authentication file, you're paying that latency five times, doing five identical filesystem reads, and generating five identical strings that get injected into five separate LLM contexts.

For a PR that touches a shared utility file — say, a database client, a token validator, an API helper — every agent wants to read it. Every agent needs to read it. That's the whole point: each specialist evaluates the same code through a different lens. But the *file content* doesn't change between agents. The work is identical.

On a large PR with five shared files and five agents, you're doing 25 reads where 5 would do. At scale, with concurrency, that becomes noise in your latency, noise in your cost, and noise in your logs.

---

## The Solution That Seems Obvious in Retrospect

We built `ToolCallCache`. It's 20 lines of TypeScript:

```typescript
export class ToolCallCache {
  private readonly cache = new Map<string, string>()

  get(key: string): string | undefined {
    return this.cache.get(key)
  }

  set(key: string, value: string): void {
    this.cache.set(key, value)
  }
}
```

That's it. A `Map<string, string>`. The key is `toolName:JSON.stringify(args)`. The value is the raw result string — whatever the tool returned.

The important design decision isn't the cache itself. It's *who owns it*.

---

## Shared Instance, Fresh Stats

Each review session creates exactly one `ToolCallCache`. That instance is created in `review-runner.ts` and passed into the root `SymbolExplorer`. When multi-agent review fires up five parallel agents, each gets a *forked* SymbolExplorer:

```typescript
fork(): SymbolExplorer {
  return new SymbolExplorer(this.graph, this.repoPath, this.diff, this.cache, this.libraryVersions)
}
```

Fork shares the cache but gives each agent its own call statistics. This matters because you want per-agent telemetry — you want to know that the security agent called `get_symbol_body` twice and the blast radius agent hit the cache three times. That's how you know the system is working.

What you *don't* want is five agents each building their own private caches that never talk to each other. That's the default if you just `new SymbolExplorer()` five times. Each agent would cold-start, read everything fresh, and throw the results away when the session ends.

The shared cache means the first agent to read `authMiddleware.ts` pays the cost. Agents two through five get the cache hit for free.

---

## How It Plays Out at Runtime

Here's what the logs look like after the fix:

```
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → 177 chars
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → CACHE HIT
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → CACHE HIT
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → CACHE HIT
[tool] read_file({"file_path":"src/authMiddleware.ts"}) → CACHE HIT
```

One real read. Four cache hits. The file content is identical in all five agent contexts. The latency is paid once.

For a typical five-agent review run on a PR touching two or three shared utility files, we see 60–80% cache hit rates. The session telemetry reports it explicitly:

```
security:           1 calls (1 cache hits,  1 rounds) — read_file×1
correctness:        1 calls (0 cache hits,  1 rounds) — read_file×1
performance:        1 calls (0 cache hits,  1 rounds) — read_file×1
style:              1 calls (1 cache hits,  1 rounds) — read_file×1
blast_radius:       1 calls (1 cache hits,  1 rounds) — read_file×1

Total: 5 calls, 3 cache hits (60% hit rate)
```

---

## Session Scope Is the Key Design Constraint

The cache lifetime is exactly one review session — from when `review-runner.ts` creates it to when the function returns. It is not persisted to Redis. It is not shared across PRs. It is not a long-lived in-memory singleton.

This is intentional. The cache stores file contents from the local checkout of a specific PR's source branch. That content is valid for the duration of one review. Between reviews — especially incremental reviews on a PR that received new commits — the file contents change. A persistent cache would serve stale data.

The garbage collector handles cleanup. When the session ends, the `ToolCallCache` instance goes out of scope and gets collected. No eviction logic needed. No TTL. No cleanup routine.

This is the right tradeoff when your unit of work is a single bounded operation (one review) rather than a long-running service. Simple scope beats clever eviction every time.

---

## Context7 and the Cross-Agent Hit Rate

When we added `get_library_docs` — our tool for fetching live library documentation from Context7 — the cache became even more valuable.

Library documentation requests are expensive. They're HTTP calls to an external service, they return large payloads, and they're deterministic: the same library at the same version returns the same docs regardless of which agent is asking.

Without the cache, if the security agent fetched `jsonwebtoken` docs to verify `jwt.verify` semantics, and the correctness agent independently needed the same thing, you'd make two identical outbound HTTP requests. With the shared cache, the second agent hits the key `get_library_docs:{"library":"jsonwebtoken","query":"jwt.verify...","version":"9.0.0"}` and gets the docs instantly.

```
[tool] get_library_docs({"library":"jsonwebtoken","query":"jwt.decode vs jwt.verify"}) → 60 chars
[tool] get_library_docs({"library":"jsonwebtoken","query":"jwt.decode vs jwt.verify"}) → CACHE HIT
```

Same principle, different consequence: now you're caching external API results across agents, not just local disk reads. The cache pays for itself on the first duplicate `get_library_docs` call.

---

## What We Learned

The lesson isn't "caching is good." Everyone knows that. The lesson is about scope and ownership in multi-agent systems.

When you parallelize work across agents, your first instinct is to give each agent a clean isolated environment. That's right for *state* — you want fresh statistics, fresh conversation context, fresh tool-call history. But it's wrong for *read-only results*. File contents, symbol bodies, library documentation — these don't change mid-review. Sharing them is safe and makes the system meaningfully faster.

The pattern generalizes: in any multi-agent system, ask "is this read-only for the duration of this session?" If yes, share the cache. If the result can change, don't.

It's a 20-line class. It cuts redundant work in half. Sometimes the most important architectural decisions look like nothing.

---

*Next: how we built the @ryv command system — letting developers trigger reviews, fixes, and docs lookups with a plain PR comment.*
