# v3 Quality Sprint — Implementation Plan

> **Branch:** `feat/v3-quality-sprint`
> **Scope:** 5 independent work items, each a separate commit.

---

## Item 1 — Symbol-Level `uses` Edges

**Why:** `imports` edges today store file paths as `from`, which BFS can't traverse.
Every imported symbol lands at `graphDistance=3` (sentinel) regardless of real
proximity — making the graph-distance re-ranking formula nearly useless.
Fixing this makes graph-aware RAG work as designed.

**How it works:** Parsers pre-scan import statements to collect locally-imported names,
then walk each symbol's body looking for identifiers that match. When found, emit
`{ from: 'file:SymbolId', to: 'ImportedName', kind: 'uses' }`.
`InMemorySymbolGraph.addEdge` already resolves `calls` edges through `nameToIds`
— one line extends this to `uses`.

### Files

| File | Change |
|------|--------|
| `packages/core/src/graph/InMemorySymbolGraph.ts` | Extend `resolveCallTarget` check: `e.kind === 'calls' \|\| e.kind === 'uses'` |
| `packages/core/src/parser/TypeScriptParser.ts` | Add `collectImportedNames()` + `extractUses()`, wire into `parseFile` |
| `packages/core/src/parser/PythonParser.ts` | Same |
| `packages/core/src/parser/JavaParser.ts` | Same |
| `packages/core/src/parser/GoParser.ts` | `collectImportedPackages()` + selector-expression `uses` via `pkg.Symbol` |
| `packages/core/src/parser/CSharpParser.ts` | Same (lower signal — aliased `using` directives only precise) |

### Per-parser import extraction

**TypeScript:** `import_statement` → `import_clause` → named specifiers + aliases + namespace `*`.
**Python:** `import_from_statement` → names after `import` keyword; `aliased_import` → alias wins.
**Java:** `import_declaration` → last segment of qualified name; skip wildcards `.*`.
**Go:** `import_spec` → local alias or last path segment; scan `selector_expression` `pkg.Symbol` bodies.
**C#:** `using_directive` → aliased forms precise; plain namespace last segment (harmless noise).

### `extractUses` helper (shared pattern)

```typescript
function extractUses(node, fromId, importedNames, seen, edges) {
  if (node.type === 'identifier' && importedNames.has(node.text)) {
    const key = `${fromId}::${node.text}`
    if (!seen.has(key)) { seen.add(key); edges.push({ from: fromId, to: node.text, kind: 'uses' }) }
  }
  for (const child of node.namedChildren) extractUses(child, fromId, importedNames, seen, edges)
}
```

### Commits

1. `feat(core): resolve uses edges through nameToIds in InMemorySymbolGraph`
2. `feat(core/parser): emit symbol-level uses edges in TypeScriptParser`
3. `feat(core/parser): emit symbol-level uses edges in PythonParser`
4. `feat(core/parser): emit symbol-level uses edges in JavaParser`
5. `feat(core/parser): emit symbol-level uses edges in GoParser`
6. `feat(core/parser): emit symbol-level uses edges in CSharpParser`

---

## Item 2 — Harness Engineering

Pure prompt + temperature changes — zero new infrastructure.

### 2a. Per-agent temperature (`multi-agent.ts`)

Currently all agents run at `temperature=0`. Change `runSingleAgent` to use a per-role
temperature map so creative/style agents get variance while security/compliance stay deterministic.

```typescript
const AGENT_TEMPERATURE: Record<AgentRole, number> = {
  security:             0.1,  // near-deterministic — false positives are costly
  correctness:          0.2,  // deterministic but slightly flexible
  performance:          0.2,
  style_maintainability: 0.4, // more variance is fine — style is subjective
  ticket_compliance:    0.1,  // deterministic — facts only
  blast_radius:         0.2,
};
```

Replace the hardcoded `0` in `runSingleAgent`:
```typescript
const result = await llm.generateReview({ ...context, agentRole: role, agentDirective: AGENT_DIRECTIVES[role] }, AGENT_TEMPERATURE[role]);
```

### 2b. Context manifest header (`prompt.ts`)

Before the `## Review Instructions` section, inject a manifest that tells the agent
exactly what context data it has been given. Agents currently don't know what they
have — this eliminates "I don't have enough context to assess this" hedging.

```
## Context Available to You
The following data has been loaded for this review:
- Diff: ${diff.files.length} changed files (+${totalAdded}/-${totalRemoved} lines)
${graphContext ? `- Symbol graph: ${changedSymbolCount} changed symbols, ${callerCount} direct callers, ${calleeCount} direct callees, blast radius risk score ${blastScore}/100` : '- Symbol graph: not available for this repo'}
${tickets.length > 0 ? `- Linked tickets: ${tickets.map(t => t.key).join(', ')}` : '- Linked tickets: none'}
${rules.length > 0 ? `- Enforced rules: ${rules.length} active` : '- Enforced rules: none'}
${priorExamples.length > 0 ? `- Team feedback examples: ${priorExamples.length} accepted, ${rejectedExamples.length} rejected` : ''}

You MUST use all available context above in your review. Do not say you lack context
if it is listed here.
```

### 2c. Pre-completion checklist (`prompt.ts`)

Append to `## Review Instructions`:

```
Before submitting your review, verify:
[ ] I checked every caller listed in the Codebase Context for impacts
[ ] I verified each Linked Ticket acceptance criterion against the diff (if tickets present)
[ ] I checked each Enforced Rule against the changed code (if rules present)
[ ] Every comment I am posting has a specific line reference and is not speculative
```

### 2d. Adversarial self-reflection (`self-reflection.ts`)

Change the self-reflection scoring prompt from "assess quality" framing to
adversarial "try to disprove" framing. The current prompt asks the LLM to score
comments — the new prompt asks it to challenge them.

Current framing:
> "Score each comment 0–10 for quality and actionability"

New framing:
> "For each comment, act as a skeptical senior engineer who wants to REJECT the
> comment. Try to find a reason why this comment is wrong, speculative, or not
> actionable. If you can find a reason to reject it, score it low. Only score it
> high if you CANNOT find a valid objection."

### 2e. Within-agent semantic dedup (`multi-agent.ts`)

Currently `themeDedupeComments()` runs once after all agents merge.
Apply it per-agent output before passing to the Judge — prevents a single agent
from producing 3 slightly different versions of the same finding.

In `runSingleAgent`, after parsing comments:
```typescript
const comments = themeDedupeComments(result.comments.map(c => ({ ...c, sourceAgent: role })));
```

### Commits

7. `feat(reviewer): per-agent LLM temperature map in multi-agent runner`
8. `feat(reviewer): context manifest header and pre-completion checklist in review prompt`
9. `feat(reviewer): adversarial framing in self-reflection second pass`
10. `feat(reviewer): per-agent semantic dedup before Judge merge`

---

## Item 3 — Mermaid Call-Flow Diagram in PR Description

**Why:** Graph data (`blastRadius`, callers, callees) already exists in
`GraphReviewContext` — we never render it visually. Greptile's most-praised feature
is its sequence diagrams. We can do the same with our real call graph.

**Where:** Injected into the PR description body generated by `generateAndUpdatePRDescription`
in `packages/reviewer/src/index.ts`. It appears as a collapsible `<details>` block
after the walkthrough so it doesn't clutter simple PRs.

### New function: `serializeMermaidGraph(ctx: GraphReviewContext): string`

Add to `packages/reviewer/src/llm/prompt.ts` (or a new `mermaid.ts` helper):

```typescript
export function serializeMermaidGraph(ctx: GraphReviewContext): string {
  // Build nodes: changed symbols + their direct callers/callees
  // Limit to 15 nodes total — beyond that the diagram is unreadable
  const nodes = new Set<string>()
  const edges: string[] = []

  const label = (sym: ParsedSymbol) =>
    sym.qualifiedName.length > 30
      ? sym.qualifiedName.slice(0, 27) + '...'
      : sym.qualifiedName

  for (const sym of ctx.changedSymbols.slice(0, 5)) {
    nodes.add(`C_${sanitize(sym.id)}["${label(sym)} ⬅ changed"]`)
  }
  for (const caller of ctx.callers.slice(0, 5)) {
    const id = `K_${sanitize(caller.id)}`
    nodes.add(`${id}["${label(caller)}"]`)
    for (const changed of ctx.changedSymbols.slice(0, 3)) {
      edges.push(`  ${id} --> C_${sanitize(changed.id)}`)
    }
  }
  for (const callee of ctx.callees.slice(0, 5)) {
    const id = `E_${sanitize(callee.id)}`
    nodes.add(`${id}["${label(callee)}"]`)
    for (const changed of ctx.changedSymbols.slice(0, 3)) {
      edges.push(`  C_${sanitize(changed.id)} --> ${id}`)
    }
  }

  if (nodes.size === 0) return ''

  const lines = [
    '\`\`\`mermaid',
    'flowchart LR',
    ...Array.from(nodes).map(n => `  ${n}`),
    ...edges,
    '\`\`\`',
  ]
  return `\n<details>\n<summary>Call graph</summary>\n\n${lines.join('\n')}\n\n</details>\n`
}
```

### Wire-up

In `packages/reviewer/src/llm/prompt.ts`, `buildPRDescriptionPrompt` or in
`generateAndUpdatePRDescription` in `index.ts`, append `serializeMermaidGraph(graphContext)`
to the generated description body before calling `updatePRDescription`.

### Commit

11. `feat(reviewer): add Mermaid call-flow diagram to PR description`

---

## Item 4 — PR Quality Score

**Why:** PMs and managers want a single scannable number. Per-comment confidence
(0–1) already exists — this is just aggregation.

**What it produces:**
- A `prScore` field on `ReviewResult` (0–100)
- A label added to the PR: `quality: 85/100` or `quality: 42/100 ⚠️`
- A line in the PR description SUMMARY: `**PR Quality Score: 85/100** — 3 issues found`

### Scoring formula

```typescript
function computePRScore(comments: ReviewComment[]): number {
  if (comments.length === 0) return 100

  // Weight by severity: error=3, warning=2, info=1
  const severityWeight = { error: 3, warning: 2, info: 1 }
  const totalPenalty = comments.reduce((sum, c) => {
    const confidence = c.confidence ?? 0.7
    const weight = severityWeight[c.severity ?? 'info'] ?? 1
    return sum + confidence * weight
  }, 0)

  // Normalize: penalty of 10 = score of 0; penalty of 0 = score of 100
  const score = Math.max(0, Math.round(100 - totalPenalty * 5))
  return Math.min(100, score)
}
```

### Files

| File | Change |
|------|--------|
| `packages/reviewer/src/types.ts` | Add `prScore?: number` to `ReviewResult` |
| `packages/reviewer/src/index.ts` | Compute + attach `prScore` after filter/dedup |
| `packages/reviewer/src/review/multi-agent.ts` | Same for multi-agent path |
| `packages/reviewer/src/index.ts` | Add `quality: XX/100` label in `generateAndUpdatePRDescription` |
| `packages/reviewer/src/llm/prompt.ts` | `buildPRDescriptionPrompt` — inject score into SUMMARY |

### Commit

12. `feat(reviewer): compute PR quality score and add as label + summary line`

---

## Item 5 — `@ryv` Mention Command System (replaces `/ask`)

**Why:** `/ask` is hard-wired, one-command, no NLP. The `@ryv` approach uses LLM
intent classification so users write natural language — the system routes it.
This also unblocks all future commands (test gen, docs, changelog) as they just
register a handler in the registry.

**Trigger:** `@ryv <anything>` in any PR comment. Legacy `/ask` keeps working as
a direct alias to the `ask` handler (no NLP pass needed).

**Bot name:** `@ryv` (configurable via `RYV_BOT_NAME` env var, default `ryv`).

### v1 handlers (only these for now)

| Command | Trigger phrases | What it does |
|---------|----------------|--------------|
| `ask` | "what does this do", "explain", "why" | Q&A on PR with graph context |
| `review` | "re-review", "check again", "review this" | Triggers fresh full review |
| `help` | "help", "what can you do" | Posts command list |

`test`, `docs`, `changelog`, `ticket_create`, `similar` — registered in registry with
`comingSoon: true` flag so they appear in `/help` output but return a friendly "not yet
available" message. This sets up the structure for v3 Phase 3.

### New module: `packages/reviewer/src/commands/`

```
commands/
├── types.ts          — CommandContext, CommandIntent, CommandResult, CommandDescriptor
├── registry.ts       — COMMAND_REGISTRY (all descriptors + handlers)
├── dispatcher.ts     — NLP intent classifier (one small LLM call)
├── index.ts          — barrel export
└── handlers/
    ├── ask.ts        — wraps existing buildAskPrompt logic from ask-runner.ts
    ├── review.ts     — posts "Review triggered…" then fires runReview via callback
    └── help.ts       — posts markdown table of all commands
```

### New file: `packages/api/src/command-runner.ts`

Bridge between webhook payload and `CommandDispatcher`. Replaces `ask-runner.ts`
(which remains as a thin wrapper calling the `ask` handler for backward compat).

### Webhook change: `packages/api/src/routes/webhooks.ts`

Replace `handleAskCommand` with `handleRyvCommand`:

```typescript
const isRyvMention  = body.includes(`@${RYV_BOT_NAME}`)
const isLegacyAsk   = body.startsWith('/ask ')

if (isRyvMention) {
  const afterMention = body.split(`@${RYV_BOT_NAME}`)[1]?.trim() ?? ''
  runCommand({ ...ctx, userQuery: afterMention })
} else if (isLegacyAsk) {
  const question = body.slice('/ask '.length).trim()
  runCommand({ ...ctx, userQuery: question, forceCommand: 'ask' })
}
```

Works for both GitHub (`issue_comment`) and Azure (`git.pullrequest.comment.created`).

### Commits

13. `feat(reviewer): @ryv command types, registry, and NLP dispatcher`
14. `feat(reviewer): ask, review, and help command handlers`
15. `feat(api): command-runner bridge and @ryv webhook detection`

---

## Build Order

Items are independent and can be built in parallel. Suggested order by risk/reward:

```
1. Harness Engineering     — zero infra, pure prompt/temp changes, immediate quality win
2. PR Quality Score        — small, standalone, immediately visible
3. Mermaid Diagram         — small, standalone
4. @ryv Command System     — medium, builds on existing ask-runner
5. Symbol uses edges       — touches 6 files, higher risk, highest long-term impact
```

---

## Env Vars Added

| Variable | Default | Description |
|----------|---------|-------------|
| `RYV_BOT_NAME` | `ryv` | Bot mention trigger (allows custom bot names) |
| `COMMAND_MAX_PER_HOUR` | `10` | Max `@ryv` calls per PR per hour |
