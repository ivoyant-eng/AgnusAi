# Plan: Harness Engineering — Agent Quality Improvements

> **Source:** LangChain "Improving Deep Agents with Harness Engineering" (March 2026)
> **Roadmap ref:** `docs/roadmap/v4.md` — Sprint 0 (Harness Engineering)
> **Effort:** Small–Medium (all prompt/middleware changes — zero new infrastructure)
> **Status:** 📋 Planned

---

## What This Is

LangChain moved a coding agent from rank 30 to rank 5 on a benchmark — **without changing the model** — by only improving the harness: the prompts, tools, and middleware wrapped around it. They called this "harness engineering."

Ryv's multi-agent system has the same improvement surface. All six tasks below are changes to prompts, agent config, or lightweight middleware logic. No new packages, no schema migrations, no infrastructure changes.

**Expected outcome:** 15–30% reduction in false-positive comments, improved citation accuracy (line numbers, rule references, callers), and better calibration in the self-reflection pass — measurable by tracking comment acceptance rate in the pgvector RAG loop.

---

## Current Pipeline (What We're Improving)

```
PR submitted
    ↓
buildReviewPrompt()         ← prompt.ts — injects diff, graph context, rules, examples
    ↓
6 specialist agents         ← multi-agent.ts — parallel fan-out, each with AGENT_DIRECTIVES
    ↓
themeDedupeComments()       ← multi-agent.ts — semantic dedup by identifier overlap
    ↓
llmJudge()                  ← multi-agent.ts — LLM consolidation, drops hedging/duplicates
    ↓
runSelfReflection()         ← self-reflection.ts — re-scores 0-10, drops below threshold
    ↓
filterByConfidence()        ← precision-filter.ts — final confidence gate
    ↓
postReview()                ← index.ts — posts to GitHub/GitLab/Azure
```

---

## Task 1 — Adversarial Self-Reflection

**File:** `packages/reviewer/src/review/self-reflection.ts`
**Function:** `buildReflectionPrompt()` (line 4)
**Effort:** 30 minutes

### Problem

LangChain found that models exhibit strong **confirmation bias** toward their own output. Asking a model to "score its own comments 0–10" is a weak adversarial signal — the model already believes its comments are correct and scores them accordingly.

The fix: change the cognitive task from *"assess quality"* to *"try to disprove it."* These produce different outputs. A model that has to actively search for evidence that refutes a finding gives a much more calibrated score.

### Current prompt structure (line 10–16)

```
You are reviewing AI-generated code review comments for quality.
For each numbered finding below, assign a score 0-10:
- 10: Definite bug, security issue...
- 0-3: Noise — too vague, cannot be confirmed...
```

### New prompt structure

Replace `buildReflectionPrompt()` entirely:

```typescript
function buildReflectionPrompt(comments: ReviewComment[]): string {
  const numbered = comments
    .map((c, i) => `${i + 1}. [${c.path}:${c.line}] ${c.body.split('\n')[0].slice(0, 200)}`)
    .join('\n');

  return [
    'You are adversarially reviewing AI-generated code review comments.',
    'For each finding, your job is to try to REFUTE it first.',
    'Search the diff for evidence that contradicts or undermines the finding.',
    '',
    'Scoring rules:',
    '- 8-10: You tried to refute it and could not. Concrete evidence in the diff confirms the issue.',
    '- 5-7:  Partially verifiable. The concern is real but incompletely evidenced from the diff alone.',
    '- 0-4:  You found a refutation, OR the finding is vague, speculative, or cannot be confirmed from the diff.',
    '',
    'Key refutation signals (score 0-4 if any apply):',
    '- "verify that...", "ensure this...", "not explicitly shown" — unconfirmed speculation',
    '- No specific line number that demonstrates the problem',
    '- The fix is already present elsewhere in the diff',
    '- The comment addresses a non-issue given the surrounding context',
    '',
    'Respond ONLY in this format (one number per finding, comma-separated, same order as input):',
    'SCORES: 8, 3, 9, 2, 7',
    '',
    'Findings:',
    numbered,
  ].join('\n');
}
```

### Why this works

The original prompt asks: "Is this comment good?" The new prompt asks: "Can you prove this comment wrong?" The latter is a fundamentally different reasoning task that forces the model to engage with the diff evidence rather than ratify its prior output.

### Acceptance criteria

- `SELF_REFLECTION_ENABLED=true` — adversarial pass drops 20–40% more comments than the old pass on the same PR (verifiable by enabling verbose logging).
- `minSurvivors` guard still applies — if the pass drops everything, the top N by score survive (no regression to zero-comment PRs).
- Graceful degradation unchanged — if LLM call fails, all comments pass through.

---

## Task 2 — Context Manifest Header

**File:** `packages/reviewer/src/llm/prompt.ts`
**Function:** `buildReviewPrompt()` (line 6)
**Effort:** 1 hour

### Problem

LangChain's `LocalContextMiddleware` auto-injected a manifest of the environment — directory structure, available tools, Python version — before the agent started work. Agents stopped making wrong assumptions because they could *see* what was available.

Ryv injects graph context, rules, examples, and tickets into the prompt — but the agent gets no explicit signal that these sections exist and must be used. An agent can technically ignore the callers list and still produce valid-format output. Adding a manifest at the top of the prompt explicitly tells each agent what data it has and that it must use all of it.

### Where to inject

In `buildReviewPrompt()`, after the `roleSection` is computed (line ~56) and before the opening system line. This becomes the very first text the agent reads.

### Manifest builder

Add a new helper function:

```typescript
function buildContextManifest(context: ReviewContext): string {
  const { graphContext, tickets } = context;
  const lines: string[] = ['## Context Available to You'];
  lines.push('You have access to the following data. Use ALL of it — a finding that ignores available context is incomplete.\n');

  // Graph context
  if (graphContext) {
    const callerCount = (graphContext.blastRadius.directCallers.length +
      graphContext.blastRadius.transitiveCallers.length);
    const symbolCount = graphContext.changedSymbols.length;
    const neighborCount = graphContext.semanticNeighbors.length;
    lines.push(`- **Symbol graph:** ${symbolCount} changed symbol(s), ${callerCount} known caller(s), ${neighborCount} semantic neighbor(s) — see ## Codebase Context`);
  }

  // Rules
  if (graphContext?.enforcedRules?.length) {
    lines.push(`- **Team rules:** ${graphContext.enforcedRules.length} active rule(s) scoped to this PR — see ## Rule Enforcement Requirements`);
  }

  // Prior examples
  if (graphContext?.priorExamples?.length) {
    lines.push(`- **Prior accepted comments:** ${graphContext.priorExamples.length} example(s) of feedback this team marked useful — see ## Examples`);
  }

  // Rejected examples
  if (graphContext?.rejectedExamples?.length) {
    lines.push(`- **Prior rejected comments:** ${graphContext.rejectedExamples.length} example(s) of feedback this team found unhelpful — see ## Examples`);
  }

  // Tickets
  if (tickets?.length) {
    lines.push(`- **Linked tickets:** ${tickets.length} ticket(s) with acceptance criteria — see ## Linked Tickets`);
  }

  lines.push('');
  return lines.join('\n');
}
```

### Inject at the top of `buildReviewPrompt()`

```typescript
// Add after all sections are computed, prepend to the return string
const manifestSection = buildContextManifest(context);

return `You are an expert code reviewer. Review this pull request and provide detailed, actionable feedback.

${manifestSection}
## PR Information
...
```

### Acceptance criteria

- Manifest section appears at the top of every prompt where graph context, rules, or tickets are present.
- For PRs with no graph context (no indexed repo), the manifest section is omitted entirely.
- No manifest lines reference internal tool names ("blast radius", "pgvector") — use plain descriptions.

---

## Task 3 — Pre-Completion Checklist Per Specialist Agent

**File:** `packages/reviewer/src/llm/prompt.ts`
**Function:** `buildReviewPrompt()` — the `roleSection` injection (line 56–58)
**Effort:** 1 hour

### Problem

LangChain's `PreCompletionChecklistMiddleware` was their highest-yield single change. Models naturally stop after producing their first pass of output, skipping verification. The checklist forces agents to confirm they used all available context before submitting.

Ryv's specialist agents currently receive a role directive via `roleSection` but have no structured verification step.

### What to change

The `roleSection` in `buildReviewPrompt()` currently injects:

```typescript
const roleSection = agentRole
  ? `\n## Specialist Role\nRole: ${agentRole}\n${agentDirective ?? ''}\n`
  : '';
```

Extend this to append a completion checklist when the agent has context to verify:

```typescript
function buildAgentChecklist(context: ReviewContext): string {
  const { graphContext, tickets } = context;
  const checks: string[] = [];

  if (graphContext) {
    const callerCount = graphContext.blastRadius.directCallers.length +
      graphContext.blastRadius.transitiveCallers.length;
    if (callerCount > 0) {
      checks.push(`- [ ] I checked the ${callerCount} known caller(s) in ## Codebase Context. If any caller is affected by this change, I mentioned it.`);
    }
  }

  if (graphContext?.enforcedRules?.length) {
    checks.push(`- [ ] I checked all ${graphContext.enforcedRules.length} active rule(s) in ## Rule Enforcement Requirements. If any apply, I cited the rule name inline.`);
  }

  if (tickets?.length) {
    checks.push(`- [ ] I checked the acceptance criteria in ## Linked Tickets before completing my ticket_compliance findings.`);
  }

  // Always-on checks
  checks.push(`- [ ] Each finding I am posting has a specific line number from the diff.`);
  checks.push(`- [ ] Each finding has a concrete suggested action, not just a description of the problem.`);
  checks.push(`- [ ] I have not flagged the same issue twice under different wording.`);

  if (checks.length === 0) return '';

  return [
    '\n## Pre-Submission Verification',
    'Before returning your output, confirm each item below.',
    'If any item is not checked, revise your findings first.\n',
    ...checks,
    '',
  ].join('\n');
}
```

Then in `buildReviewPrompt()`:

```typescript
const checklist = agentRole ? buildAgentChecklist(context) : '';

const roleSection = agentRole
  ? `\n## Specialist Role\nRole: ${agentRole}\n${agentDirective ?? ''}\n${checklist}`
  : '';
```

### Note on non-agent path

The checklist is only injected when `agentRole` is set (specialist agents). The single-agent path in `index.ts` that calls `buildReviewPrompt()` without an agent role does **not** get the checklist — that path is handled by the self-reflection pass instead.

### Acceptance criteria

- Checklist appears in each specialist agent prompt when graph context, rules, or tickets are available.
- Checklist items are specific to what data is actually present (no phantom "check the callers" item when there are no callers).
- No regression on PRs with no graph context — checklist is skipped entirely.

---

## Task 4 — Per-Agent Reasoning Budget

**File:** `packages/reviewer/src/review/multi-agent.ts`
**Effort:** 1 hour

### Problem

LangChain's "reasoning sandwich" insight: running every agent at max reasoning causes timeouts and performs worse than a tiered approach. Different agents have fundamentally different reasoning demands. Style/maintainability comments are mostly mechanical pattern-matching. Security findings require deep multi-step reasoning.

All agents in Ryv currently call `llm.generate()` / `llm.generateReview()` with the same parameters. The `temperature` param already exists in `BaseLLMBackend.generate()` but is only used by the judge (`temperature=0`) and self-reflection (`temperature=0`).

### Temperature map

Add a `AGENT_TEMPERATURES` constant near the top of `multi-agent.ts`:

```typescript
// Reasoning budget per agent role.
// Lower temperature = more deterministic / less creative.
// Higher temperature = more exploratory reasoning (better for adversarial security analysis).
// The judge and self-reflection always use 0 (deterministic selection tasks).
const AGENT_TEMPERATURES: Record<AgentRole, number> = {
  security:              0.3,  // needs depth, some exploration for edge cases
  correctness:           0.2,  // logic errors benefit from focused reasoning
  blast_radius:          0.2,  // graph traversal is structured, low creativity needed
  ticket_compliance:     0.1,  // verification task — highly deterministic
  performance:           0.2,  // pattern recognition, mostly deterministic
  style_maintainability: 0.4,  // more stylistic variance acceptable
};
```

### Where to wire it

In `runEnabledSpecialists()` (wherever `llm.generateReview(context)` is called per agent), pass the role's temperature:

```typescript
const temperature = AGENT_TEMPERATURES[role] ?? 0.2;
const result = await llm.generateReview(agentContext, temperature);
```

The summary agent and judge already use `temperature=0` via explicit argument — no change needed there.

### Env var override

Add optional env var for teams who want to tune globally:

```env
AGENT_TEMPERATURE_OVERRIDE=0.2   # overrides all per-agent values when set
```

### Acceptance criteria

- Each specialist agent uses its configured temperature, not the backend's default.
- Judge and self-reflection continue using `temperature=0`.
- `AGENT_TEMPERATURE_OVERRIDE` overrides all when set.
- No change to public API or ReviewConfig — this is internal wiring only.

---

## Task 5 — Within-Agent Semantic Dedup Before Judge Input

**File:** `packages/reviewer/src/review/multi-agent.ts`
**Functions:** `themeDedupeComments()` (line 143), `runEnabledSpecialists()`
**Effort:** 2 hours

### Problem

`themeDedupeComments()` already exists and works well — it deduplicates comments that share the same code identifiers within a file. But it is currently applied **after** all agents are merged, as part of the Judge input preparation.

The problem: if a single agent (say, `security`) generates 4 findings that are variations of the same root cause, all 4 hit the Judge. The Judge has to do more work, uses more tokens, and occasionally keeps 2 instead of 1 because the wording is different enough to fool the identifier overlap check.

Apply `themeDedupeComments()` **per-agent output** before merging, so the Judge receives maximally clean input.

### Where to apply

After each specialist agent returns its `ReviewComment[]` and before they are merged into `allComments`:

```typescript
// Pseudocode for the fan-out section in runEnabledSpecialists()
const agentResults = await Promise.allSettled(
  enabledRoles.map(role => runSingleAgent(llm, role, context))
);

// Apply within-agent dedup before merging
const cleanedOutputs = agentResults
  .filter(r => r.status === 'fulfilled')
  .map(r => ({
    role: r.value.role,
    comments: themeDedupeComments(r.value.comments),  // ← NEW: dedup per agent
    result: r.value.result,
  }));

const allComments = cleanedOutputs.flatMap(o => o.comments);
```

### Telemetry

Log per-agent dedup counts so we can measure impact:

```typescript
const before = r.value.comments.length;
const after = themeDedupeComments(r.value.comments).length;
if (before !== after) {
  console.log(`[within-agent-dedup] ${role}: ${before} → ${after} comments`);
}
```

### Acceptance criteria

- Each agent's output is deduplicated by theme before merging.
- The Judge receives no more than one comment per theme per agent.
- Per-agent dedup stats are logged at debug level.
- Existing cross-agent `themeDedupeComments()` pass remains — this is additive.

---

## Task 6 — Agent Quality Report (Trace Analyzer)

**Files:** New route + dashboard component
**Effort:** Large (2–3 days, dashboard + API)

### Problem

LangChain's most powerful long-term technique: build a **trace analyzer** that automatically analyses failed/rejected runs to identify patterns in bad output and feed them back into harness improvements.

Ryv already has all the data needed — accepted vs. rejected review comments are stored and used for the pgvector RAG loop. What doesn't exist is an aggregated view showing:
- Which agent generates the most rejected comments
- What the most common rejection reasons are per agent
- Whether comment quality is trending up or down over time

This turns prompt tuning from guesswork into data-driven iteration.

### Data model

Add to Postgres (or derive from existing `review_feedback` table):

```sql
-- This view derives agent quality stats from existing feedback data.
-- No schema change needed if review_feedback already stores sourceAgent.
CREATE VIEW agent_quality_stats AS
SELECT
  source_agent,
  COUNT(*) FILTER (WHERE feedback = 'accepted')  AS accepted,
  COUNT(*) FILTER (WHERE feedback = 'rejected')  AS rejected,
  COUNT(*) FILTER (WHERE feedback = 'dismissed') AS dismissed,
  COUNT(*) AS total,
  ROUND(
    COUNT(*) FILTER (WHERE feedback = 'accepted')::numeric / NULLIF(COUNT(*), 0) * 100,
    1
  ) AS acceptance_rate_pct,
  MAX(created_at) AS last_updated
FROM review_feedback
GROUP BY source_agent;
```

If `review_feedback` does not currently store `source_agent`, add the column and backfill NULL for historical rows.

### API route

**File:** `packages/api/src/routes/repos.ts` (or a new `packages/api/src/routes/analytics.ts`)

```
GET /api/repos/:id/analytics/agent-quality
```

Response:

```typescript
interface AgentQualityReport {
  generatedAt: string;
  repoId: string;
  period: '7d' | '30d' | '90d' | 'all';
  agents: Array<{
    role: AgentRole;
    accepted: number;
    rejected: number;
    dismissed: number;
    total: number;
    acceptanceRatePct: number;
    topRejectionPatterns: string[];   // top 3 most common first-line bodies of rejected comments
  }>;
  overall: {
    acceptanceRatePct: number;
    totalReviewed: number;
    trend: 'improving' | 'stable' | 'declining';  // compare last period vs previous
  };
}
```

### Dashboard component

**File:** `packages/dashboard/src/` — new tab in the existing repo detail page (alongside Settings, Rules, etc.)

**Tab name:** "Review Quality"

**Components:**

```
AgentQualityReport
  ├── OverallQualityCard         — big acceptance rate number + trend indicator
  ├── AgentQualityTable          — one row per agent: role, accepted/total, rate, trend sparkline
  └── TopRejectionPatterns       — per-agent expandable: top rejected comment bodies
```

The `TopRejectionPatterns` panel is the "trace analyzer" equivalent — it shows the team what the agent keeps getting wrong so they can act on it (either tune the AGENT_DIRECTIVES in `multi-agent.ts` or file a bug).

### Env var

```env
QUALITY_ANALYTICS_ENABLED=true   # default: true — disable to hide the tab
```

### Acceptance criteria

- `/api/repos/:id/analytics/agent-quality` returns per-agent acceptance rates.
- Dashboard "Review Quality" tab renders the report with at minimum: table of agents with acceptance rates, and the top 3 rejected comment bodies per agent.
- Report supports `?period=30d` query param.
- If no feedback data exists for a repo, the tab shows an empty state ("No feedback recorded yet — react to review comments to start building quality data").

---

## Build Order

These tasks are independent except where noted:

| # | Task | Depends On | Branch | Est. |
|---|---|---|---|---|
| 1 | Adversarial self-reflection | — | `feat/adversarial-reflection` | 30 min |
| 2 | Context manifest header | — | `feat/context-manifest` | 1 hr |
| 3 | Pre-completion checklist | Task 2 (same file) | `feat/context-manifest` | 1 hr |
| 4 | Per-agent reasoning budget | — | `feat/agent-temperatures` | 1 hr |
| 5 | Within-agent dedup | — | `feat/within-agent-dedup` | 2 hrs |
| 6 | Agent quality report | — | `feat/agent-quality-report` | 2–3 days |

Tasks 1–5 can ship together in a single PR. Task 6 is standalone (requires dashboard work).

**Recommended:** Ship Tasks 1–5 first and run them for 2–4 weeks, then use the acceptance rate data from Task 6 to measure the delta.

---

## How to Measure Success

All six improvements compound on the same metric: **comment acceptance rate** in the pgvector RAG loop.

Baseline: establish acceptance rate per agent over the 30 days before the changes land.
After: compare rate for the same period post-ship.

Secondary metrics:
- Average confidence score of surviving comments (should increase)
- Number of comments with no cited line number (should drop toward zero)
- Number of comments with no rule citation when rules were active (should drop)

If the Agent Quality Report (Task 6) is built first, these baselines are automatic.
