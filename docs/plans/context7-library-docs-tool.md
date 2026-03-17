# Context7 Library Docs Tool — Plan

> **Status:** Planned — Phase 1 ready to implement
> **Goal:** Let the review LLM call Context7 at review time to get up-to-date, version-specific library documentation, so it can catch API misuse, deprecated method calls, and version-specific bugs that training data alone cannot surface.

---

## The Problem

The current review pipeline has a blind spot for external library usage. When the LLM sees:

```diff
- const user = await prisma.user.findUnique({ where: { id } })
+ const user = await prisma.user.findFirst({ where: { id } })
```

It has to rely on what it learned at training cutoff. It can't know whether:

- `findFirst` vs `findUnique` has a correctness implication for this Prisma version
- An AWS SDK v2 method was removed in v3 (common silent bug on upgrades)
- A Next.js `fetch` cache option changed between App Router minor versions
- A React hook has a new signature in React 19

Context7 solves this by delivering **live, version-specific documentation** at query time. The LLM calls a tool, gets back the current API docs for the exact version in `package.json`, and can then write a precise, accurate comment instead of guessing or staying silent.

---

## What Context7 Is

Context7 (https://context7.com) is an Upstash service that indexes library documentation from GitHub repos, websites, OpenAPI specs, and `llms.txt` files — and serves it via REST API and MCP at query time.

**Two-step query pattern:**

1. **Resolve** — fuzzy-match a library name to a Context7 library ID
   - `GET https://context7.com/api/v2/libs/search?libraryName=prisma&query=findFirst`
   - Returns: `[{ id: "/prisma/prisma", title: "Prisma", versions: ["5.10.0", "4.16.0", ...] }]`

2. **Fetch** — get ranked code snippets and prose for a query
   - `GET https://context7.com/api/v2/context?libraryId=/prisma/prisma/v5.10.0&query=findFirst vs findUnique`
   - Returns: `{ codeSnippets: [{title, code, language}], infoSnippets: [{content}] }`

Auth: `Authorization: Bearer ctx7sk...` (API key from context7.com/dashboard). Anonymous access works at low rate limits.

---

## What Already Exists in Ryv

The integration fits the existing tool-use architecture with minimal friction:

| Existing component | What it does | How Context7 plugs in |
|---|---|---|
| `SymbolExplorer.ts` | Executes tools (`get_symbol_body`, `find_callers`, `find_callees`, `read_file`) and injects descriptions into the prompt | Add `get_library_docs` as a 5th tool |
| `BaseLLMBackend` tool loop | ReAct pattern — parses `<tool_call>` blocks, executes, injects `<tool_result>`, continues | No change needed |
| `ToolCallCache` | Session-scoped `Map<key, result>` shared across all specialist agents | Context7 responses cached by `library:query:version` |
| Per-agent forking | Each specialist gets a `SymbolExplorer` fork; same session cache beneath | Context7 calls from different agents are deduplicated automatically |
| `ReviewContext.symbolExplorer` | Carrier that wires tools into the LLM call | No change |

---

## Architecture

```
Diff arrives
      │
      ▼
library-detector.ts
  - Parse import/require statements from diff
  - Read package.json from repoPath → resolve installed versions
  - Returns: Map<libraryName, installedVersion>
  e.g. { "prisma": "5.10.0", "axios": "1.6.2", "next": "14.2.0" }
      │
      ▼
SymbolExplorer constructed with libraryVersions map
  - 5th tool: get_library_docs(library, query, version?)
  - version auto-resolved from map if not specified by LLM
      │
      ▼
[Optional] Preemptive fetch (CONTEXT7_PREEMPTIVE=true)
  - For top 1-2 most-referenced external libraries in diff:
    fetch docs before LLM sees the prompt
  - Inject as ## Library Context section in the prompt
  - LLM gets docs without spending a tool-call round
      │
      ▼
Review LLM (single-agent or specialist agents)
  - Sees tool description: get_library_docs for npm packages,
    get_symbol_body for internal code
  - Calls tool when it needs to verify external API usage
      │
      ▼
Context7Client.ts
  - resolve-library-id → /v2/libs/search
  - query-docs       → /v2/context
  - Formats response as clean markdown for tool_result injection
  - Cached in ToolCallCache
```

---

## Files to Create / Modify

### New Files

**`packages/reviewer/src/tools/Context7Client.ts`**

Thin HTTP wrapper around Context7's REST API. Exposes a single function that does resolve + fetch in one call.

```typescript
/**
 * Fetches up-to-date documentation for an npm library from Context7.
 *
 * Internally: resolves libraryName → library ID, then fetches ranked docs for the query.
 * If version is provided, it is appended to the library ID for version-specific results.
 *
 * Returns a formatted markdown string of code snippets and prose, ready for injection
 * as a <tool_result> block in the LLM's tool loop.
 */
export async function fetchLibraryDocs(
  libraryName: string,
  query: string,
  version?: string,
  apiKey?: string,
  maxTokens?: number,
): Promise<string>
```

Response format injected back to LLM:
```
## prisma@5.10.0 — findFirst vs findUnique

[prose from infoSnippets]

### Code Examples
```ts
[code from codeSnippets]
```
```

**`packages/reviewer/src/review/library-detector.ts`**

Parses diff for external library imports and resolves installed versions from `package.json`.

```typescript
/**
 * Detects external npm libraries referenced in the PR diff and resolves their installed
 * versions from the project's package.json.
 *
 * Returns a Map<libraryName, installedVersion> for all detected external dependencies.
 * Libraries not found in package.json are included with version = undefined.
 */
export async function detectLibrariesInDiff(
  diff: Diff,
  repoPath: string,
): Promise<Map<string, string | undefined>>
```

Detection strategy:
- Matches `import ... from 'library'` and `require('library')` in diff hunk content
- Strips relative paths (`.`, `..`) and path segments (`library/sub/path` → `library`)
- Reads `dependencies`, `devDependencies`, `peerDependencies` from `package.json`
- Strips semver prefixes (`^1.2.3` → `1.2.3`)

### Modified Files

**`packages/reviewer/src/tools/SymbolExplorer.ts`**

- Constructor accepts optional `libraryVersions: Map<string, string>` parameter
- Adds `get_library_docs` to `executeTool()` dispatch
- Adds tool description to `toolDescriptionPrompt()`:

```
get_library_docs(library, query, version?)
  Use for EXTERNAL npm package calls in the diff — not for internal project code.
  library: npm package name (e.g. "prisma", "axios", "next", "express")
  query:   what you want to verify (e.g. "findFirst uniqueness guarantee")
  version: optional — auto-resolved from package.json if omitted
  Returns: current API documentation and code examples from the official library docs.

  Use get_symbol_body for internal/project-defined code.
  Use get_library_docs for imported npm packages.
```

**`packages/reviewer/src/llm/prompt.ts`**

- Add `serializeLibraryDocs()` helper
- Add `## Library Context` section to `buildReviewPrompt()` when preemptive docs are injected (only when `CONTEXT7_PREEMPTIVE=true` and `ReviewContext.libraryDocs` is populated)

**`packages/reviewer/src/types.ts`**

```typescript
interface ReviewContext {
  // ... existing fields ...
  /** Pre-fetched library docs (populated when CONTEXT7_PREEMPTIVE=true) */
  libraryDocs?: Map<string, string>
}
```

**`packages/api/src/review-runner.ts`**

```typescript
// After building symbolExplorer:
if (process.env.CONTEXT7_ENABLED === 'true' && repoPath) {
  const libraryVersions = await detectLibrariesInDiff(diff, repoPath)
  symbolExplorer = new SymbolExplorer(entry.graph, repoPath, diff, sessionCache, libraryVersions)

  if (process.env.CONTEXT7_PREEMPTIVE === 'true') {
    libraryDocs = await prefetchTopLibraryDocs(libraryVersions, diff)
    // injected into ReviewContext.libraryDocs → prompt
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTEXT7_ENABLED` | `false` | Master toggle. Off by default — opt-in. |
| `CONTEXT7_API_KEY` | — | API key from context7.com/dashboard. Anonymous works at low rate limits. |
| `CONTEXT7_MAX_TOKENS` | `4000` | Max tokens of docs returned per `get_library_docs` call. |
| `CONTEXT7_PREEMPTIVE` | `false` | Pre-fetch docs for top detected libraries before the LLM sees the diff. Costs one API call per library but saves tool-call rounds. |

---

## What the LLM Interaction Looks Like

### Tool-call path (on-demand)

```
[LLM reviewing a diff that replaces findUnique with findFirst]

<tool_call>{"tool": "get_library_docs", "args": {
  "library": "prisma",
  "query": "findFirst vs findUnique correctness and uniqueness guarantee"
}}</tool_call>

<tool_result tool="get_library_docs">
## prisma@5.10.0 — findFirst vs findUnique

`findUnique` requires a `@unique` field or `@@unique` constraint. It maps to
`SELECT ... LIMIT 1` with a unique index — guaranteed single result.

`findFirst` accepts any where clause, adds `ORDER BY` internally, and returns
the first match. If the field is not unique in your schema, it can silently
return the wrong record.

### Code
```ts
// Correct — id is always the primary key
const user = await prisma.user.findUnique({ where: { id } })

// Works but semantically wrong for primary keys; findUnique is preferred
const user = await prisma.user.findFirst({ where: { id } })
```
</tool_result>

→ LLM comment posted:
"[File: src/users.ts Line: 42]
`findFirst` is used here but `id` is the primary key — `findUnique` is the
correct method. `findFirst` emits an unnecessary `ORDER BY` and doesn't
communicate the uniqueness invariant to readers. Swap to `findUnique`.
[Confidence: 0.92]"
```

### Preemptive path (injected before prompt)

```
## Library Context
The following documentation was pre-fetched for libraries heavily used in this diff.
Use this context when evaluating API usage in the changed files.

### prisma@5.10.0
[top snippets from Context7 for changes detected in the diff]

### next@14.2.0
[top snippets from Context7 for next/cache and fetch options]
```

---

## Example Bugs Context7 Enables Catching

| Scenario | Without Context7 | With Context7 |
|----------|-----------------|---------------|
| `prisma.findFirst` on a primary key | LLM might miss it | Knows `findUnique` is correct, posts precise comment |
| AWS SDK v2 `S3.upload()` in a v3 project | LLM might not know v3 uses `@aws-sdk/client-s3` | Fetches v3 docs, catches the import mismatch |
| `axios.get` with `baseURL` in `options` (v1.x moved it to `config`) | LLM unsure | Fetches axios@1.x docs, confirms correct field |
| React `useEffect` deps array with `useCallback` | LLM might give stale advice | Fetches React 19 docs on stable callbacks |
| `next/headers` in a Pages Router file | LLM might miss it | Fetches Next.js 14 docs, flags wrong router context |

---

## Caveats and Limits

- **Only indexes open-source npm packages.** Internal/private packages won't be in Context7's index. The LLM should fall back to `get_symbol_body` for those.
- **Trust score matters.** Context7 returns a `trustScore` per library. Only libraries with high trust scores should trigger preemptive fetching to avoid injecting low-quality docs.
- **Rate limits.** Anonymous tier has low limits; `CONTEXT7_API_KEY` needed for production use.
- **Token cost.** Each `get_library_docs` call injects up to `CONTEXT7_MAX_TOKENS` tokens into the LLM context. Keep this in mind for large PRs with many library calls.
- **Version pinning.** Semver ranges (`^5.0.0`) are resolved to the installed version from `package.json` lockfile, not the range. This requires `package-lock.json` or `pnpm-lock.yaml` to be present in the repo.

---

## Prioritized Build Sequence

| # | Task | Effort |
|---|------|--------|
| 1 | `Context7Client.ts` — HTTP wrapper, resolve + fetch, format response | ~3h |
| 2 | Add `get_library_docs` to `SymbolExplorer` tool dispatch + description | ~2h |
| 3 | `library-detector.ts` — import parser + package.json version lookup | ~3h |
| 4 | Wire `libraryVersions` into `SymbolExplorer` constructor in `review-runner.ts` | ~1h |
| 5 | Preemptive fetch + `## Library Context` prompt injection | ~3h |
| 6 | Env vars + docs | ~1h |

Phases 1–4 are the core feature. Phase 5 (preemptive) is an enhancement and can ship separately.
