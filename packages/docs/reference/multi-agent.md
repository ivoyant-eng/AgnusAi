# Multi-Agent Review

Multi-agent review runs multiple specialized LLM agents in parallel — each focused on a different risk domain — then consolidates their findings through a judge pass before posting.

## Why Multi-Agent?

A single reviewer prompt trying to catch security vulnerabilities, logic errors, performance issues, and style problems simultaneously produces noisier, lower-recall output. Specialist agents with focused directives:

- **Higher recall** — each agent is prompted to find only its domain, reducing missed findings
- **Lower noise** — the judge eliminates cross-agent duplicates and keeps only high-signal comments
- **Transparent attribution** — every comment is tagged with the agent that raised it

## Agent Roles

| Agent | Focus |
|-------|-------|
| `security` | Exploitable vulnerabilities, auth/authz gaps, unsafe data handling, secrets exposure |
| `correctness` | Logic errors, race conditions, null/edge-case handling, behavior regressions |
| `performance` | Algorithmic complexity, redundant I/O, N+1 patterns, hot-path inefficiencies |
| `style_maintainability` | Maintainability that impacts future defects: complexity, readability, brittle abstractions |
| `ticket_compliance` | Whether implementation matches linked ticket intent and acceptance criteria _(enabled only when ticket context exists)_ |
| `blast_radius` | Change impact on dependent callers/modules, missing adaptations _(enabled only when graph context exists)_ |

## Pipeline

```
Webhook / API trigger
        │
        ▼
  Context collector  ←── diff, graph context, rules, prior examples
        │
   ┌────┴────────────────────────────────────────┐
   ↓            ↓           ↓           ↓         ↓
security   correctness  performance  style  blast_radius
  (LLM)      (LLM)        (LLM)     (LLM)    (LLM)
   └────┬────────────────────────────────────────┘
        │  parallel — up to AGENT_CONCURRENCY at once
        ▼
  Deduplication  (normalize + similarity key)
        │
        ▼
     Judge pass
   deterministic  ─── keep strongest per-location finding
   (or LLM judge) ─── select high-signal subset, emit final verdict
        │
        ▼
  Post to PR / save telemetry
```

## Configuration

Enable multi-agent mode via environment variables:

```env
# Enable the multi-agent pipeline
MULTI_AGENT_ENABLED=true

# Review mode controls which agents run
# single    — original single-agent mode (default)
# fast      — security + correctness only
# thorough  — all applicable agents (recommended)
REVIEW_MODE=thorough

# How many agents run simultaneously
AGENT_CONCURRENCY=2

# Override to run a specific subset of agents
# ENABLED_AGENTS=security,correctness

# Judge configuration
JUDGE_ENABLED=true
JUDGE_MODE=deterministic   # deterministic | llm
```

### Review Modes

| Mode | Agents | Use when |
|------|--------|---------|
| `single` | 1 (original behavior) | Fast checks, cost-sensitive |
| `fast` | security + correctness | Lightweight CI enforcement |
| `thorough` | All applicable | Full review for PRs targeting main |

### Judge Modes

| Mode | Behavior |
|------|---------|
| `deterministic` | For each file:line, keeps the single highest-severity/confidence finding. Always available, zero extra LLM calls. |
| `llm` | Sends all candidate findings to the LLM for final ranking and selection. Falls back to deterministic if the LLM response is unparseable. |

## Agent Telemetry

Every multi-agent run records one row per agent in `review_agent_telemetry`:

| Column | Description |
|--------|-------------|
| `agent_role` | Which agent ran |
| `verdict` | Agent's individual verdict |
| `comment_count` | Comments raised by this agent |
| `duration_ms` | Wall-clock time for this agent |
| `tokens_used` | Total tokens consumed (prompt + completion) |
| `error` | Error message if the agent failed |

View telemetry in the Dashboard under **Repo → Agent Telemetry**, or query:

```bash
GET /api/repos/:id/agent-telemetry?days=30
```

## Token Usage

Token usage is tracked per agent and aggregated at the org level. View it in **Settings → Token Usage** with a custom date range filter broken down by agent, repository, and day.

```bash
GET /api/orgs/:orgKey/token-usage?from=2026-01-01&to=2026-02-01
```

## Cost Considerations

Multi-agent mode uses `N_agents × tokens_per_review` tokens per PR. With `AGENT_CONCURRENCY=2` and a medium-sized diff (~150k characters):

| Mode | Agents | Approx tokens/PR |
|------|--------|-----------------|
| `single` | 1 | ~8k |
| `fast` | 2 | ~16k |
| `thorough` | 5 | ~40k |

Use `MAX_DIFF_SIZE` to cap diff size and `AGENT_CONCURRENCY` to control parallelism/cost.
