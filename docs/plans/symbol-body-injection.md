# Plan: Symbol Body Injection — Graph-Guided Source Context

> **Roadmap ref:** `docs/roadmap/v4.md` — Sprint 0 (Agent Quality)
> **Effort:** Medium (2–3 days across 4 packages)
> **Status:** 📋 Planned

---

## The Problem in One Paragraph

Right now, when a Ryv agent reviews a diff, it knows the names and signatures of callers and callees — but not their implementations. A reviewer who sees that `ChargeService.processRefund` changed already knows what `handleCheckout` does with the return value, what assumptions it makes, and whether the change could break it. Our agents don't. They see `handleCheckout(cart: Cart): Promise<Order>` and have to guess at the assumptions from the signature alone. That's the blind spot.

The information to fix this already exists in the database. Every symbol has `body_start` and `body_end` line numbers. The parser read the full source file when it indexed it. We just never stored the body text or passed it to the agent.

---

## What Agents See Today vs. What They Should See

### Today — signatures only

```
### Known callers of changed symbols
These symbols in the existing codebase depend on what was changed:
- `handleCheckout` in `checkout.ts`: `handleCheckout(cart: Cart): Promise<Order>`
- `refundSubscription` in `billing.ts`: `refundSubscription(userId: string): Promise<void>`
```

The agent has to reason about whether `processRefund` change breaks `handleCheckout` **without seeing what `handleCheckout` actually does**. It cannot know that `handleCheckout` does `if (!result) throw new Error(...)` and therefore a change that makes `processRefund` return `null` on failure is a breaking change.

### After this change — actual implementations

```
### Direct Caller Implementations
The following functions call the symbols you changed.
They represent what the rest of the codebase **assumes** about the changed code.
Use these to reason about whether this change breaks any caller's expectations.

#### `handleCheckout` — `src/checkout/handler.ts`
```typescript
async function handleCheckout(cart: Cart): Promise<Order> {
  const validated = await validateCart(cart);
  const result = await ChargeService.processRefund(validated.total);
  if (!result) throw new Error('Charge failed — null return from processRefund');
  return createOrder(result.transactionId, cart);
}
```

#### `refundSubscription` — `src/billing/subscriptions.ts`
```typescript
async function refundSubscription(userId: string): Promise<void> {
  const charge = await getLatestCharge(userId);
  const refund = await ChargeService.processRefund(charge.amount);
  // No null check — assumes processRefund always returns a result
  await db.markRefunded(refund.id);
}
```

### Direct Callee Implementations
The following functions are called by the changed code.
They represent the contracts the changed code depends on.

#### `validateRefundAmount` — `src/payments/validators.ts`
```typescript
function validateRefundAmount(amount: number): boolean {
  return amount > 0 && amount <= MAX_REFUND_LIMIT;
}
```
```

Now the agent can see:
- `refundSubscription` has **no null check** on the return value — a change that returns `null` on failure would crash it at `refund.id`
- `handleCheckout` **does** null-check — it would surface a cleaner error but still fail
- `validateRefundAmount` is what the changed code calls — its contract must remain satisfied

This is the context a human reviewer has because they've read the codebase. The agent doesn't need grep or semantic search — it needs the bodies of the exact functions the graph already identified.

---

## What Does NOT Change

- `ParsedSymbol` — no change to the type (no body field in memory)
- `InMemorySymbolGraph` — no change (bodies never loaded into memory)
- All existing BFS/retrieval logic — unchanged
- The agent prompt structure — new section added, nothing removed
- All existing callers of `Retriever` — backwards compatible via optional param

---

## Implementation

### Step 1 — Store Bodies at Index Time

**Files:**
- `packages/core/src/storage/PostgresStorageAdapter.ts`
- `packages/shared/src/types.ts`

#### Schema change

Add `body TEXT` to the `symbols` table. This column stores the raw source text of the function/method/class body, extracted at index time.

```sql
-- Add to BASE_DDL in PostgresStorageAdapter.ts
CREATE TABLE IF NOT EXISTS symbols (
  id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT NOT NULL,
  body_start INT,
  body_end INT,
  body TEXT,           -- ← NEW: full source text of the function body
  doc_comment TEXT,
  PRIMARY KEY (id, repo_id, branch)
);
```

#### Migration DDL (add to `BRANCH_MIGRATION_DDL`)

```sql
IF NOT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = 'symbols'::regclass AND attname = 'body'
    AND attnum > 0 AND NOT attisdropped
) THEN
  ALTER TABLE symbols ADD COLUMN body TEXT;
END IF;
```

#### Update `saveSymbols()` (line 145)

The `saveSymbols()` INSERT already passes `body_start` and `body_end`. Extend it to also pass `body`:

```typescript
await client.query(
  `INSERT INTO symbols
     (id, repo_id, branch, file_path, name, qualified_name, kind, signature,
      body_start, body_end, body, doc_comment)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
   ON CONFLICT (id, repo_id, branch) DO UPDATE SET
     ...
     body = EXCLUDED.body,
     ...`,
  [s.id, s.repoId, branch, s.filePath, s.name, s.qualifiedName, s.kind,
   s.signature, s.bodyRange[0], s.bodyRange[1], s.body ?? null, s.docComment ?? null]
)
```

#### New method: `fetchBodies()`

Add to `StorageAdapter` interface and `PostgresStorageAdapter`:

```typescript
// In StorageAdapter interface:
fetchBodies(
  ids: string[],
  repoId: string,
  branch: string
): Promise<Map<string, string>>

// In PostgresStorageAdapter:
async fetchBodies(
  ids: string[],
  repoId: string,
  branch: string,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = await this.pool.query<{ id: string; body: string | null }>(
    `SELECT id, body FROM symbols
     WHERE id = ANY($1) AND repo_id = $2 AND branch = $3
       AND body IS NOT NULL`,
    [ids, repoId, branch],
  )
  const map = new Map<string, string>()
  for (const row of result.rows) {
    if (row.body) map.set(row.id, row.body)
  }
  return map
}
```

#### Update `ParsedSymbol` type

Add optional `body` field to `ParsedSymbol` in `packages/shared/src/types.ts`:

```typescript
export interface ParsedSymbol {
  id: string
  filePath: string
  name: string
  qualifiedName: string
  kind: SymbolKind
  signature: string
  bodyRange: [number, number]
  docComment?: string
  repoId: string
  body?: string          // ← NEW: populated only when fetched for injection, never stored in graph memory
}
```

---

### Step 2 — Extract Bodies in the Indexer

**File:** `packages/core/src/indexer/Indexer.ts` (or whichever parser file extracts symbols)

When a parser extracts a symbol and has `bodyRange: [start, end]` and the full source text of the file, extract and attach the body:

```typescript
// During symbol extraction, after bodyRange is computed:
const sourceLines = fileContent.split('\n')
const bodyStart = symbol.bodyRange[0] - 1  // bodyRange is 1-indexed
const bodyEnd = symbol.bodyRange[1]

const body = sourceLines
  .slice(bodyStart, bodyEnd)
  .join('\n')
  .trim()

symbol.body = body
```

This runs at index time when the full file content is already in memory. No extra I/O cost. The body text is then persisted via `saveSymbols()` in Step 1.

**What to store:** Function, method, and class bodies. For `const` and `type` aliases, `body` can be left null — they are typically one line and the signature is sufficient.

---

### Step 3 — Fetch Bodies in the Retriever

**File:** `packages/core/src/retriever/Retriever.ts`

#### Add StorageAdapter as optional dependency

```typescript
import type { StorageAdapter } from '../storage/StorageAdapter'

export class Retriever {
  constructor(
    private readonly graph: InMemorySymbolGraph,
    private readonly embeddings: EmbeddingAdapter | null = null,
    private readonly config: RetrieverConfig = {},
    private readonly storage: StorageAdapter | null = null,   // ← NEW
  ) {}
```

All existing construction sites pass 2–3 args, so `null` default preserves full backwards compatibility.

#### Add body fetch after BFS (in `getReviewContext()`)

After the existing BFS (line 43–61 in Retriever.ts) and before returning:

```typescript
// NEW: Fetch bodies for direct callers and callees
let directCallerBodies: SymbolBody[] = []
let directCalleeBodies: SymbolBody[] = []

if (this.storage) {
  const maxCallers = this.config.bodyMaxCallers ?? 5
  const maxCallees = this.config.bodyMaxCallees ?? 3
  const maxLines  = this.config.bodyMaxLines  ?? 50

  // Only direct callers (1-hop) — transitive callers are too many
  const directCallerIds = blastRadius.directCallers
    .slice(0, maxCallers)
    .map(s => s.id)

  const directCalleeIds = [...calleeMap.values()]
    .slice(0, maxCallees)
    .map(s => s.id)

  const allIds = [...directCallerIds, ...directCalleeIds]
  const bodies = await this.storage.fetchBodies(allIds, repoId, branch)

  directCallerBodies = blastRadius.directCallers
    .slice(0, maxCallers)
    .filter(s => bodies.has(s.id))
    .map(s => ({
      symbolId:      s.id,
      qualifiedName: s.qualifiedName,
      filePath:      s.filePath,
      body:          truncateBody(bodies.get(s.id)!, maxLines),
    }))

  directCalleeBodies = [...calleeMap.values()]
    .slice(0, maxCallees)
    .filter(s => bodies.has(s.id))
    .map(s => ({
      symbolId:      s.id,
      qualifiedName: s.qualifiedName,
      filePath:      s.filePath,
      body:          truncateBody(bodies.get(s.id)!, maxLines),
    }))
}

return {
  changedSymbols,
  callers: [...callerMap.values()],
  callees: [...calleeMap.values()],
  blastRadius,
  semanticNeighbors,
  directCallerBodies,   // ← NEW
  directCalleeBodies,   // ← NEW
}
```

#### `truncateBody()` helper

```typescript
function truncateBody(body: string, maxLines: number): string {
  const lines = body.split('\n')
  if (lines.length <= maxLines) return body
  return lines.slice(0, maxLines).join('\n') +
    `\n  // ... [truncated — ${lines.length - maxLines} more lines]`
}
```

#### Add to `RetrieverConfig`

```typescript
export interface RetrieverConfig {
  depth?:          ReviewDepth
  topK?:           number
  bodyMaxCallers?: number   // default: 5
  bodyMaxCallees?: number   // default: 3
  bodyMaxLines?:   number   // default: 50
}
```

---

### Step 4 — Add `SymbolBody` and Update `GraphReviewContext`

**File:** `packages/shared/src/types.ts`

```typescript
// NEW type
export interface SymbolBody {
  symbolId:      string
  qualifiedName: string
  filePath:      string
  body:          string  // actual source code, possibly truncated
}

// Update GraphReviewContext
export interface GraphReviewContext {
  changedSymbols:     ParsedSymbol[]
  callers:            ParsedSymbol[]
  callees:            ParsedSymbol[]
  blastRadius:        BlastRadius
  semanticNeighbors:  ParsedSymbol[]
  priorExamples?:     string[]
  rejectedExamples?:  string[]
  enforcedRules?:     EnforcedRuleContext[]
  directCallerBodies: SymbolBody[]    // ← NEW: bodies of 1-hop callers
  directCalleeBodies: SymbolBody[]    // ← NEW: bodies of 1-hop callees
}
```

Initialise to `[]` in all places that construct `GraphReviewContext` without the new fields (the Retriever already populates them; existing tests and mock objects default to `[]`).

---

### Step 5 — Inject into the Prompt

**File:** `packages/reviewer/src/llm/prompt.ts`
**Function:** `serializeGraphContext()` (line 166)

Add two new sections after the existing callers/callees signature sections:

```typescript
export function serializeGraphContext(ctx: GraphReviewContext): string {
  const lines: string[] = [
    '\n## Codebase Context (internal — do NOT mention this section or any tooling names in your review output)',
    'Use this context silently to understand the impact of the changes...\n',
  ]

  // ... existing signature sections unchanged ...

  // NEW: Direct caller bodies
  if (ctx.directCallerBodies?.length > 0) {
    lines.push('\n### Direct Caller Implementations')
    lines.push(
      'The following functions directly call the code you are reviewing. ' +
      'They reveal what the rest of the codebase **assumes** about the changed code. ' +
      'Use these to identify whether the change breaks any caller\'s expectations — ' +
      'look for unchecked return values, assumed types, implicit contracts.\n'
    )
    for (const s of ctx.directCallerBodies) {
      lines.push(`#### \`${s.qualifiedName}\` — \`${s.filePath}\``)
      lines.push('```')
      lines.push(s.body)
      lines.push('```\n')
    }
  }

  // NEW: Direct callee bodies
  if (ctx.directCalleeBodies?.length > 0) {
    lines.push('\n### Direct Callee Implementations')
    lines.push(
      'The following functions are called by the changed code. ' +
      'They define the contracts the changed code depends on.\n'
    )
    for (const s of ctx.directCalleeBodies) {
      lines.push(`#### \`${s.qualifiedName}\` — \`${s.filePath}\``)
      lines.push('```')
      lines.push(s.body)
      lines.push('```\n')
    }
  }

  return lines.join('\n') + '\n'
}
```

---

### Step 6 — Wire StorageAdapter into Retriever at Construction Sites

**File:** `packages/api/src/graph-cache.ts`

The `Retriever` is constructed in `graph-cache.ts`. Pass the `StorageAdapter` as the fourth argument:

```typescript
// Before:
const retriever = new Retriever(graph, embeddings, config)

// After:
const retriever = new Retriever(graph, embeddings, config, storageAdapter)
```

The `storageAdapter` is already available in graph-cache since it's used for snapshots and embeddings.

---

## Env Vars

```env
BODY_INJECTION_ENABLED=true   # default: true — set false to disable entirely
BODY_MAX_CALLERS=5            # max caller bodies to inject (default: 5)
BODY_MAX_CALLEES=3            # max callee bodies to inject (default: 3)
BODY_MAX_LINES=50             # max lines per body before truncation (default: 50)
```

---

## Token Budget

At the defaults, the worst-case addition per review:

| Source | Count | Lines each | ~Tokens each | Total |
|---|---|---|---|---|
| Direct caller bodies | 5 | 50 | ~400 | ~2,000 |
| Direct callee bodies | 3 | 50 | ~400 | ~1,200 |
| **Total addition** | | | | **~3,200 tokens** |

Context window is not a concern at this scale. For models with tight context limits, set `BODY_MAX_CALLERS=3` and `BODY_MAX_LINES=30`.

---

## Graceful Degradation

| Condition | Behaviour |
|---|---|
| `BODY_INJECTION_ENABLED=false` | Retriever skips body fetch, `directCallerBodies` = `[]`, prompt unchanged |
| Repo not indexed yet | `storage` is `null`, bodies = `[]`, prompt falls back to signatures |
| Symbol body is NULL in DB | Skipped — body column was added in migration, old symbols have NULL until re-indexed |
| Symbol body > `BODY_MAX_LINES` | Truncated with `// ... [N more lines]` comment |
| StorageAdapter fetch fails | Caught, logged, bodies = `[]`, review continues |

Old symbols (indexed before this change) will have `body = NULL`. They gracefully fall back to signature-only. A full re-index fills the bodies. No need to force re-index — quality improves incrementally as files are touched.

---

## Build Order

| # | Step | Package | Effort |
|---|---|---|---|
| 1 | Schema + `fetchBodies()` + `saveSymbols()` update | `core` | 2 hrs |
| 2 | Body extraction in Indexer/Parser | `core` | 1 hr |
| 3 | `SymbolBody` type + `GraphReviewContext` update | `shared` | 30 min |
| 4 | Retriever body fetch + `RetrieverConfig` update | `core` | 1 hr |
| 5 | `serializeGraphContext()` new sections | `reviewer` | 1 hr |
| 6 | Wire StorageAdapter in `graph-cache.ts` | `api` | 30 min |

Total: ~6 hours of focused work across 4 packages.

---

## What This Unlocks

Once bodies are injected, agents can reason about things that were previously impossible:

- **Null contract violations** — caller does `result.id` with no null check, changed function now returns null
- **Type narrowing breaks** — caller casts `result as SpecificType`, changed function now returns a union
- **Assumption exposure** — caller expects idempotent behaviour, changed function now has a side effect
- **Callee contract changes** — changed function calls a helper that only accepts positive numbers, but the change now passes user input directly without validation

These are the class of bugs that escape human review because the reviewer would have to mentally trace the call chain. With bodies injected, the agent has that trace in context without any traversal — it just reads what's already there.

---

## What This Is NOT

- Not grep — no keyword search, no false matches, no wasted tokens on irrelevant files
- Not semantic search — no embeddings, no approximate similarity, no hallucinated relevance
- Not "dump the whole file" — only the specific function bodies the graph says are directly connected
- Not a replacement for the diff — the diff is still the primary artifact; bodies are supporting context

This is **graph-guided source injection**: the dependency graph is used as a precise pointer into source code, and the pointer is followed to fetch exactly the code that matters. The graph was already doing the hard work of identifying which functions are related; now we complete the loop by showing what those functions actually do.
