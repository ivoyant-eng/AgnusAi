# Plan: Graph-Scoped Pattern Search — Call Site Analysis

> **Roadmap ref:** `docs/roadmap/v4.md` — Sprint 0 (Agent Quality)
> **Depends on:** `docs/plans/symbol-body-injection.md` — requires `StorageAdapter.fetchBodies()` and the `body` column to be present
> **Effort:** Medium (2–3 days across 4 packages)
> **Status:** 📋 Planned

---

## The Core Idea

The symbol dependency graph already tells us exactly which functions call the changed code. `symbol-body-injection.md` adds the ability to fetch and inject those functions' full bodies. This plan goes one step further: instead of giving the agent an entire function body and asking it to find the relevant lines, **we search those bodies for us** and hand the agent structured, pre-classified results.

The difference:

| Approach | What the agent gets | Tokens | Precision |
|---|---|---|---|
| Signatures only (today) | `handleCheckout(cart: Cart): Promise<Order>` | ~10 | Blind |
| Body injection | Full 40-line body of `handleCheckout` | ~320 | Agent has to find the call site itself |
| **Graph-scoped search** (this plan) | `billing.ts:91 — processRefund(charge.amount) — ⚠️ unchecked` | ~30 | Agent sees the exact call site + classification |

Body injection and graph-scoped search are complementary. Body injection provides rich context about what each connected function *does*. Graph-scoped search surfaces exactly *how* the changed symbol is used across those connected functions — the specific call expressions, the return value handling, the patterns that could break.

---

## What Gets Injected

Given a change to `ChargeService.processRefund`, and a connected caller `billing/subscriptions.ts`, the agent currently sees:

```
### Known callers of changed symbols
- `refundSubscription` in `billing/subscriptions.ts`: `refundSubscription(userId: string): Promise<void>`
```

After this plan, it also sees:

```
### Call Site Analysis — `processRefund`

How the changed symbol is used across connected callers:

| File | Line | Call Expression | Return Handling |
|------|------|-----------------|-----------------|
| `checkout/handler.ts` | 48 | `processRefund(validated.total)` | ✅ null-checked |
| `billing/subscriptions.ts` | 92 | `processRefund(charge.amount)` | ⚠️ unchecked — direct property access |
| `refund-worker.ts` | 23 | `processRefund(job.amount, opts)` | ⚠️ unchecked — direct property access |

⚠️ 2 of 3 call sites do not null-check the return value.

#### `billing/subscriptions.ts` — line 91
```ts
const refund = await ChargeService.processRefund(charge.amount);
await db.markRefunded(refund.id);  // refund.id accessed directly — null would throw here
```

#### `refund-worker.ts` — line 22
```ts
const result = await processRefund(job.amount, { idempotencyKey: job.id });
await queue.complete(result.transactionId);  // result.transactionId — no null guard
```
```

The agent now knows that if `processRefund` is changed to return `null` on failure instead of throwing, it will break two out of three callers in a way that produces a runtime `TypeError` at the property access — not a clean error.

This is the reasoning a human reviewer does by ctrl+F-ing the function name and reading each call site. The agent was previously unable to do this because it only saw the diff.

---

## Why Not Grep? Why Not RAG?

**Grep over the whole repo:**
- Finds matches in docs, tests, string literals, comments, unrelated files
- Returns raw text — the agent has to classify each match itself
- Token cost scales with repo size, not with the actual blast radius

**Embeddings/RAG:**
- Returns files that are *semantically similar* — not necessarily *structurally connected*
- Approximate: may miss `billing/subscriptions.ts` if its embedding happens to be distant
- May include unrelated files that happened to use similar vocabulary

**Graph-scoped search (this plan):**
- The file set is exact — only files the graph says are directly connected
- The search is targeted — only looks for the specific symbol names that changed
- The results are pre-classified — the agent gets `⚠️ unchecked` not raw text
- Token cost is fixed and small — one table row + one snippet per call site, bounded by `CALL_SITE_MAX_SNIPPETS`

This is the insight from the LangChain harness engineering post applied to a non-interactive agent: the *harness* does the iterative search and refinement that Claude Code's model does through tool calls, then hands the agent structured output instead of raw text.

---

## Implementation

### New Types — `packages/shared/src/types.ts`

```typescript
export type ReturnHandling =
  | 'null_checked'    // if (!result) / result?.prop / result ?? fallback / null check before use
  | 'unchecked'       // result.property accessed directly with no null guard
  | 'ignored'         // void fn() or standalone call with no assignment
  | 'chained'         // fn().property or fn().then() — implicit assumption of non-null
  | 'unknown'         // cannot determine from context

export interface CallSiteMatch {
  symbolId:        string          // ID of the containing caller symbol
  qualifiedName:   string          // e.g. "refundSubscription"
  filePath:        string          // e.g. "src/billing/subscriptions.ts"
  line:            number          // absolute line number in the file
  callExpression:  string          // the actual call text, e.g. "processRefund(charge.amount)"
  returnHandling:  ReturnHandling
  snippet:         string          // 3–5 lines of surrounding source context
}
```

Add to `GraphReviewContext`:

```typescript
export interface GraphReviewContext {
  changedSymbols:     ParsedSymbol[]
  callers:            ParsedSymbol[]
  callees:            ParsedSymbol[]
  blastRadius:        BlastRadius
  semanticNeighbors:  ParsedSymbol[]
  priorExamples?:     string[]
  rejectedExamples?:  string[]
  enforcedRules?:     EnforcedRuleContext[]
  directCallerBodies: SymbolBody[]          // from symbol-body-injection plan
  directCalleeBodies: SymbolBody[]          // from symbol-body-injection plan
  callSiteAnalysis:   CallSiteMatch[]       // ← NEW: this plan
}
```

Initialise `callSiteAnalysis` to `[]` in all existing places that construct `GraphReviewContext`.

---

### New File — `packages/core/src/search/PatternSearcher.ts`

This is the entire new class. It depends on `StorageAdapter.fetchBodies()` from the body injection plan.

```typescript
import type { ParsedSymbol } from '@agnus-ai/shared'
import type { CallSiteMatch, ReturnHandling } from '@agnus-ai/shared'
import type { StorageAdapter } from '../storage/StorageAdapter'

export interface PatternSearcherConfig {
  maxSnippets?: number   // cap total call site results (default: 10)
  snippetLines?: number  // lines of context around each call (default: 3)
}

export class PatternSearcher {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly config: PatternSearcherConfig = {},
  ) {}

  /**
   * Find all call sites of `targetNames` within `connectedSymbols` bodies.
   *
   * @param connectedSymbols  Callers + callees from BFS (they have bodyRange set)
   * @param targetNames       Short names of changed symbols to search for, e.g. ["processRefund"]
   * @param repoId
   * @param branch
   */
  async findCallSites(
    connectedSymbols: ParsedSymbol[],
    targetNames: string[],
    repoId: string,
    branch: string,
  ): Promise<CallSiteMatch[]> {
    if (targetNames.length === 0 || connectedSymbols.length === 0) return []

    const maxSnippets  = this.config.maxSnippets  ?? 10
    const snippetLines = this.config.snippetLines ?? 3

    // Fetch stored bodies for all connected symbols in one DB round-trip
    const ids = connectedSymbols.map(s => s.id)
    let bodies: Map<string, string>
    try {
      bodies = await this.storage.fetchBodies(ids, repoId, branch)
    } catch (err) {
      console.warn('[PatternSearcher] fetchBodies failed — skipping call site analysis:', (err as Error).message)
      return []
    }

    const results: CallSiteMatch[] = []

    for (const symbol of connectedSymbols) {
      if (results.length >= maxSnippets) break

      const body = bodies.get(symbol.id)
      if (!body) continue  // not yet indexed with body — graceful degradation

      for (const targetName of targetNames) {
        const matches = findCallsInBody(body, targetName, symbol, snippetLines)
        for (const match of matches) {
          if (results.length >= maxSnippets) break
          results.push(match)
        }
      }
    }

    return results
  }
}

// ---------------------------------------------------------------------------
// Pattern matching helpers
// ---------------------------------------------------------------------------

function findCallsInBody(
  body: string,
  targetName: string,
  symbol: ParsedSymbol,
  snippetLines: number,
): CallSiteMatch[] {
  const lines = body.split('\n')
  const results: CallSiteMatch[] = []

  // Match bare function call or method call: `targetName(` or `.targetName(`
  // Use word boundary to avoid matching `processRefundPartial` when looking for `processRefund`
  const callRe = new RegExp(`(?:^|[^\\w])${escapeRegex(targetName)}\\s*\\(`, 'g')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    callRe.lastIndex = 0
    if (!callRe.test(line)) continue

    const callExpression = extractCallExpression(line, targetName)
    const returnHandling = classifyReturnHandling(lines, i)
    const snippetStart   = Math.max(0, i - 1)
    const snippetEnd     = Math.min(lines.length, i + snippetLines)
    const snippet        = lines.slice(snippetStart, snippetEnd).join('\n')

    results.push({
      symbolId:       symbol.id,
      qualifiedName:  symbol.qualifiedName,
      filePath:       symbol.filePath,
      line:           (symbol.bodyRange[0] ?? 1) + i,  // bodyRange is 1-indexed
      callExpression,
      returnHandling,
      snippet,
    })
  }

  return results
}

/**
 * Extract the full call expression from a line.
 * Returns everything from the function name up to and including the closing paren.
 * Falls back to the trimmed line if parsing fails.
 */
function extractCallExpression(line: string, targetName: string): string {
  const startIdx = line.indexOf(targetName)
  if (startIdx === -1) return line.trim().slice(0, 80)

  let depth = 0
  let i = startIdx
  for (; i < line.length; i++) {
    if (line[i] === '(') depth++
    else if (line[i] === ')') {
      depth--
      if (depth === 0) break
    }
  }

  return line.slice(startIdx, i + 1).trim().slice(0, 120)
}

/**
 * Classify how the return value of a call is handled.
 * Looks at the call line and the 2 lines following it.
 */
function classifyReturnHandling(lines: string[], callIdx: number): ReturnHandling {
  const callLine  = lines[callIdx]  ?? ''
  const nextLine  = lines[callIdx + 1] ?? ''
  const nextTwo   = nextLine + ' ' + (lines[callIdx + 2] ?? '')

  // Ignored: void fn() / standalone call with no assignment
  if (/^\s*(void\s+)?[\w.]+\s*\(/.test(callLine) && !/[=!<>]\s*[\w.]+\s*\(/.test(callLine)) {
    if (!callLine.includes('=')) return 'ignored'
  }

  // Chained: fn().method or fn().property immediately (same line)
  if (/\)\s*\./.test(callLine)) return 'chained'

  // Null-checked: if (!result), result?.prop, result ?? fallback, null == result, === null
  const nullCheckPatterns = [
    /if\s*\(\s*!/,
    /\?\./,
    /\?\?/,
    /null\s*[=!]=/,
    /=== null/,
    /!== null/,
    /== null/,
  ]
  if (nullCheckPatterns.some(p => p.test(nextTwo))) return 'null_checked'

  // Unchecked: result is assigned and then a property is accessed directly on the next line
  const assignMatch = callLine.match(/(?:const|let|var)\s+(\w+)\s*=/)
    ?? callLine.match(/^\s*(\w+)\s*=\s*(?:await\s+)?[\w.]+\s*\(/)
  if (assignMatch) {
    const varName = assignMatch[1]
    // Direct property access on next line with no null guard
    if (varName && new RegExp(`\\b${escapeRegex(varName)}\\s*\\.`).test(nextLine)) {
      if (!nullCheckPatterns.some(p => p.test(nextLine))) {
        return 'unchecked'
      }
    }
  }

  return 'unknown'
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
```

---

### Update `StorageAdapter` Interface

**File:** `packages/core/src/storage/StorageAdapter.ts`

Add `fetchBodies` (shared with body injection plan — only needs to be added once):

```typescript
export interface StorageAdapter {
  saveSymbols(symbols: ParsedSymbol[], branch: string): Promise<void>
  saveEdges(edges: Edge[], branch: string): Promise<void>
  deleteByFile(filePath: string, repoId: string, branch: string): Promise<void>
  deleteAllForBranch(repoId: string, branch: string): Promise<void>
  loadAll(repoId: string, branch: string): Promise<{ symbols: ParsedSymbol[]; edges: Edge[] }>
  saveGraphSnapshot(repoId: string, branch: string, json: string): Promise<void>
  loadGraphSnapshot(repoId: string, branch: string): Promise<string | null>
  fetchBodies(ids: string[], repoId: string, branch: string): Promise<Map<string, string>>  // ← shared with body injection
}
```

---

### Update `Retriever` — `packages/core/src/retriever/Retriever.ts`

Add `PatternSearcher` as an optional dependency alongside `StorageAdapter`:

```typescript
import { PatternSearcher } from '../search/PatternSearcher'

export interface RetrieverConfig {
  depth?:          ReviewDepth
  topK?:           number
  bodyMaxCallers?: number
  bodyMaxCallees?: number
  bodyMaxLines?:   number
  callSiteEnabled?: boolean   // ← NEW: default true
  callSiteMaxSnippets?: number
}

export class Retriever {
  constructor(
    private readonly graph:         InMemorySymbolGraph,
    private readonly embeddings:    EmbeddingAdapter | null = null,
    private readonly config:        RetrieverConfig = {},
    private readonly storage:       StorageAdapter | null = null,    // from body injection plan
    private readonly patternSearch: PatternSearcher | null = null,   // ← NEW
  ) {}
```

After existing BFS and before `return`, add the call site analysis:

```typescript
// NEW: Call site analysis — find exact usages of changed symbols in connected callers
let callSiteAnalysis: CallSiteMatch[] = []

const callSiteEnabled = this.config.callSiteEnabled !== false  // default true
if (callSiteEnabled && this.patternSearch && changedSymbols.length > 0) {
  // Target names: short function/method names of all changed symbols
  const targetNames = [...new Set(changedSymbols.map(s => s.name))]

  // Search within direct callers only — they are the most likely to have
  // assumptions about the changed symbol's interface
  const searchScope = blastRadius.directCallers

  try {
    callSiteAnalysis = await this.patternSearch.findCallSites(
      searchScope,
      targetNames,
      repoId,
      // branch must be threaded through — add as param to getReviewContext:
      branch ?? 'main',
    )
  } catch (err) {
    console.warn('[Retriever] Call site analysis failed:', (err as Error).message)
    // graceful degradation — review continues without call site data
  }
}

return {
  changedSymbols,
  callers: [...callerMap.values()],
  callees: [...calleeMap.values()],
  blastRadius,
  semanticNeighbors,
  directCallerBodies: directCallerBodies ?? [],
  directCalleeBodies: directCalleeBodies ?? [],
  callSiteAnalysis,                              // ← NEW
}
```

**Note:** `getReviewContext(diff, repoId)` needs a `branch` parameter for this and the body injection plan. Add it as an optional third arg defaulting to `'main'`:

```typescript
async getReviewContext(diff: string, repoId: string, branch = 'main'): Promise<GraphReviewContext>
```

Update all call sites in `packages/api/src/review-runner.ts` and `packages/api/src/routes/webhooks.ts` to pass the branch.

---

### Wire `PatternSearcher` in `packages/api/src/graph-cache.ts`

```typescript
import { PatternSearcher } from '@agnus-ai/core'

// Where Retriever is currently constructed:
const patternSearcher = storageAdapter
  ? new PatternSearcher(storageAdapter, {
      maxSnippets:  parseInt(process.env.CALL_SITE_MAX_SNIPPETS  ?? '10'),
      snippetLines: parseInt(process.env.CALL_SITE_SNIPPET_LINES ?? '3'),
    })
  : null

const retriever = new Retriever(
  graph,
  embeddings,
  config,
  storageAdapter,    // from body injection plan
  patternSearcher,   // ← NEW
)
```

---

### Update `serializeGraphContext()` — `packages/reviewer/src/llm/prompt.ts`

Add after the existing callers/callees signature sections and before the `directCallerBodies` section:

```typescript
// NEW: Call site analysis section
if (ctx.callSiteAnalysis?.length > 0) {
  lines.push('\n### Call Site Analysis')

  // Group by changed symbol name (targetName)
  const uniqueTargets = [...new Set(
    ctx.callSiteAnalysis.map(m => m.callExpression.split('(')[0].split('.').pop() ?? '')
  )]

  for (const target of uniqueTargets) {
    const matches = ctx.callSiteAnalysis.filter(m =>
      m.callExpression.includes(target)
    )

    // Count risk levels
    const unchecked   = matches.filter(m => m.returnHandling === 'unchecked' || m.returnHandling === 'chained')
    const checked     = matches.filter(m => m.returnHandling === 'null_checked')
    const ignored     = matches.filter(m => m.returnHandling === 'ignored')

    lines.push(`\nHow \`${target}\` is used across connected callers:`)
    lines.push('')
    lines.push('| File | Line | Call | Return Handling |')
    lines.push('|------|------|------|-----------------|')

    for (const m of matches) {
      const icon = {
        null_checked: '✅',
        unchecked:    '⚠️',
        chained:      '⚠️',
        ignored:      '➡️',
        unknown:      '❓',
      }[m.returnHandling]
      const label = {
        null_checked: 'null-checked',
        unchecked:    'unchecked — direct property access',
        chained:      'chained — implicit non-null',
        ignored:      'return value ignored',
        unknown:      'unknown',
      }[m.returnHandling]
      lines.push(`| \`${m.filePath}\` | ${m.line} | \`${m.callExpression.slice(0, 60)}\` | ${icon} ${label} |`)
    }

    if (unchecked.length > 0) {
      lines.push('')
      lines.push(`⚠️ **${unchecked.length} of ${matches.length} call site(s) do not null-check the return value.**`)
    }

    // Emit snippets only for risky call sites
    const riskySites = [...unchecked, ...matches.filter(m => m.returnHandling === 'chained')]
    for (const m of riskySites.slice(0, 3)) {
      lines.push(`\n\`${m.filePath}:${m.line}\``)
      lines.push('```')
      lines.push(m.snippet)
      lines.push('```')
    }
  }

  lines.push('')
}
```

---

## Pattern Classification Reference

The `classifyReturnHandling()` function uses the following heuristics. These are intentionally simple — pattern matching on 2–3 lines, not full type inference.

| Pattern | Signal | Classification |
|---|---|---|
| `if (!result)` / `result === null` / `result?.prop` / `result ?? x` after call | Explicit null guard | `null_checked` |
| `result.property` / `result.method()` on next line with no null guard | Assumes non-null | `unchecked` |
| `fn().property` on the same line | Chained, no null safety | `chained` |
| `void fn()` or call with no `=` assignment | Return value not used | `ignored` |
| Everything else | Can't determine | `unknown` |

False positive cases to be aware of:
- TypeScript non-null assertions (`result!.property`) look like `unchecked` — correct, they are unsafe
- Optional chaining on a known non-nullable type looks like `null_checked` — over-safe, not harmful
- `await fn()` without assignment looks like `ignored` — correct

These heuristics err toward flagging `unchecked` conservatively. The agent will see the snippet and can override the classification with its own reasoning.

---

## Env Vars

```env
CALL_SITE_ANALYSIS_ENABLED=true   # default: true
CALL_SITE_MAX_SNIPPETS=10         # max total call site results across all changed symbols (default: 10)
CALL_SITE_SNIPPET_LINES=3         # lines of context around each call site (default: 3)
```

---

## Token Budget

At defaults, the worst-case addition per review:

| Element | Count | ~Tokens each | Total |
|---|---|---|---|
| Summary table (header + rows) | 10 rows | ~15 | ~150 |
| Risk summary line | 1 | ~20 | ~20 |
| Risky snippets (unchecked only, max 3) | 3 × 5 lines | ~40 | ~120 |
| **Total** | | | **~290 tokens** |

This is an order of magnitude cheaper than body injection (~3,200 tokens) because it surfaces only the specific lines that matter — not entire function bodies. The two plans are additive: body injection gives the agent the full picture of what each caller does; call site analysis highlights the dangerous lines within that picture.

---

## Graceful Degradation

| Condition | Behaviour |
|---|---|
| `CALL_SITE_ANALYSIS_ENABLED=false` | Skipped entirely, `callSiteAnalysis = []` |
| `patternSearch` not passed to Retriever | Skipped, `callSiteAnalysis = []` |
| `body` column not yet added (pre-migration) | `fetchBodies` returns empty map, zero matches, no crash |
| Symbol bodies are NULL (indexed before body injection) | Gracefully skipped per symbol — partial results if some bodies exist |
| `fetchBodies` throws | Caught, logged, `callSiteAnalysis = []` — review continues |
| Changed symbol has no callers | `searchScope = []`, zero results |

---

## Build Order

| # | Step | Package | Depends on | Effort |
|---|---|---|---|---|
| 1 | `CallSiteMatch` + `ReturnHandling` types | `shared` | — | 30 min |
| 2 | `GraphReviewContext.callSiteAnalysis` field | `shared` | step 1 | 15 min |
| 3 | `StorageAdapter.fetchBodies()` | `core` | body injection plan | shared |
| 4 | `PatternSearcher` class | `core` | step 3 | 3 hrs |
| 5 | `Retriever` wiring + `branch` param | `core` | step 4 | 1 hr |
| 6 | `graph-cache.ts` wiring | `api` | step 5 | 30 min |
| 7 | `serializeGraphContext()` new section | `reviewer` | step 2 | 1 hr |

Total: ~6 hours, can be done in parallel with body injection after step 3 is shared.

---

## What This Unlocks For Each Agent

The call site analysis section is injected into every specialist agent that sees graph context. Here is what becomes possible for each:

**Security agent** — can now see whether a function that validates auth/crypto is called with its return value checked. `validateSignature(token)` returning `false` being called as `const ok = validateSignature(token); if (ok)` is safe. `validateSignature(token)` being chained as `payload.validate(token).isValid` is unsafe if it could return null.

**Correctness agent** — the most direct beneficiary. Null pointer exceptions, type narrowing breaks, and unchecked assumptions are now surfaced as classified patterns rather than things the agent has to infer from a signature.

**Blast radius agent** — previously could only say "N callers exist". Now can say "2 of N callers make unsafe assumptions about the return type — these are the specific files and lines."

**Performance agent** — can see if a changed function is being called in a loop (call site in a `for`/`while`/`.map()` body) — a pattern that makes performance regressions more severe.
