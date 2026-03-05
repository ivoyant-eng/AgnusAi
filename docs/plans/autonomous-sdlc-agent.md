# Plan: Autonomous SDLC Agent — Ticket-to-PR-to-Monitor Lifecycle

> **Status:** Planning — not yet committed
> **Roadmap ref:** `docs/roadmap/v5-autonomous-sdlc.md`
> **Premise:** Ryv already has PR review + ticket adapters + symbol graph. This plan closes the remaining two loops: (1) autonomous fix generation from signals (tickets, errors, incidents), and (2) post-merge observability feedback.

---

## What This Is

An end-to-end autonomous engineering agent that ingests signals (Jira/Linear ticket, Sentry error, PagerDuty incident, GitHub Issue), assembles codebase context from the symbol graph, generates a targeted fix, opens a PR, self-reviews it, and closes the originating ticket — all without human intervention until review approval.

The human's role shrinks to: **approve or reject a PR**. Everything else is automated.

---

## Signal Sources (Intake Layer)

These are the triggers that start the autonomous fix cycle:

| Signal | Source | What It Provides |
|---|---|---|
| Ticket created/assigned | Jira, Linear, GitHub Issues, Azure Boards | Description, acceptance criteria, priority |
| Production error | **Sentry MCP** | Stack trace, affected file + line, frequency, regression info |
| Session replay | **OpenReplay MCP** | User journey, rage clicks, form abandonment, error trail |
| Incident | **PagerDuty MCP** | Severity, affected service, on-call context, runbook links |
| Infra metric anomaly | **Datadog MCP** | Spike correlated to a recent commit, affected endpoint |

Ryv already has Jira/Linear/Azure/GitHub ticket adapters. The new work is the Sentry, OpenReplay, PagerDuty, and Datadog MCP bridges.

---

## Architecture: The FixAgent Pipeline

```
Signal Intake
    │
    ▼
TriageAgent
  - Classify: bug / feature / refactor / incident
  - Locate affected symbols in the graph (map stack trace / file path → symbol IDs)
  - Score urgency (P0–P3)
  - Route: auto-fix eligible? or needs human triage?
    │
    ▼
Context Assembler
  - Retriever.getGraphContext(affectedSymbols)  ← existing BFS retrieval
  - Sentry: error details, frequency, regression commit
  - OpenReplay: session recording summary, user journey to error
  - Ticket: title, description, acceptance criteria
  - PriorExamples: similar past fixes from pgvector
    │
    ▼
FixAgent (multi-agent, parallel)
  ├── PatchAgent        — generates the code fix as a unified diff
  ├── TestAgent         — generates or updates tests for the changed symbols
  ├── ValidationAgent   — tree-sitter syntax check + static analysis on patch
  └── ExplainAgent      — writes PR description + commit message
    │
    ▼
SandboxRunner
  - Apply patch to a branch clone
  - Run affected test suite (via CI trigger or local runner)
  - If tests pass → proceed
  - If tests fail → retry FixAgent with failure context (max 3 attempts)
    │
    ▼
PR Creator
  - git checkout -b fix/agent/<ticket-id>
  - Commit with structured message: fix(<scope>): <summary> [closes #N]
  - Push branch via GitHub/GitLab/Azure VCS adapter
  - Open PR with generated description + linked ticket + Sentry/PagerDuty links
    │
    ▼
Self-Review (existing PRReviewAgent)
  - Ryv reviews its own PR
  - Flags any issues it finds — surfaces them as PR comments
  - Posts a Ryv-confidence score for the fix
    │
    ▼
Ticket Writeback
  - Mark ticket In Review with PR link
  - Post PR URL + summary as comment on the ticket
    │
    ▼
[Human approves PR]
    │
    ▼
Post-Merge Monitor
  - Watch Sentry: did the error rate drop within 1 hour?
  - Watch Datadog/PagerDuty: did the incident close?
  - If regression detected: auto-revert PR + open new incident ticket
  - Record outcome in pgvector for future FixAgent calibration
```

---

## MCP Integrations Detail

### Sentry MCP

Sentry's official MCP server (`mcp.sentry.dev`) exposes:
- `search_issues` — find issues by project, file, frequency
- `get_issue_details` — full stack trace, breadcrumbs, tags, regression info
- `trigger_seer_analysis` — Sentry's own AI root cause analysis
- `get_fix_recommendations` — Sentry Seer fix suggestions (can supplement FixAgent output)
- `monitor_fix_status` — track whether a fix resolved the error

**Integration point in Ryv:** New `SentryAdapter` class, parallel to existing `JiraAdapter`. Triggered when an issue is tagged with a Sentry issue ID or when Sentry webhook fires on a new P0/P1 error.

### OpenReplay MCP

Community MCP server (`github.com/rsp2k/openreplay-mcp-server`) exposes:
- `search_sessions` — by date, user, error, duration
- `analyze_user_journey` — page flow + navigation before the error
- `detect_problems` — rage clicks, form abandonment, JS errors
- `get_session_summary` — AI-generated session narrative

**Integration point in Ryv:** The `Context Assembler` queries OpenReplay when a Sentry error has an associated session ID (Sentry + OpenReplay share session IDs natively). The session summary is injected into the FixAgent prompt as a `## User Journey to Error` section, giving the fix more behavioral context beyond the stack trace.

### PagerDuty MCP

PagerDuty's MCP server (generally available on Professional+ plans) exposes:
- Incident data, affected services, runbook links
- Historical incident patterns for a service
- SRE Agent integration for automated diagnostics

**Integration point in Ryv:** A `PagerDutyAdapter` that fires when a P0/P1 incident opens. Routes to TriageAgent with the full incident context. Post-merge, watches for incident resolution as the success signal.

### Datadog MCP

Datadog MCP server (AWS DevOps Agent integration) provides:
- Metric anomalies, latency spikes, error rate changes
- Commit-correlated metric changes
- APM traces linking to source code

**Integration point in Ryv:** Optional. Injects infrastructure context into the FixAgent prompt when a Sentry error co-occurs with a metric spike.

### GitHub MCP / VCS Adapter Extension

GitHub's own MCP server (100+ tools) handles:
- `create_branch` — checkout fix branch
- `create_pull_request` — open the PR
- `add_pr_comment` — post self-review results
- `update_issue` — write back to GitHub Issue with PR link

**Integration point in Ryv:** The existing `GitHubVCSAdapter` already handles PR creation. Extend with `createBranch()`, `commitPatch()`, and `closesIssue()` methods. For Jira/Linear: use existing `writeBack()` method on ticket adapters (G19 from v3 roadmap — already planned as `pr_to_ticket` reverse).

---

## Stripe Agent Toolkit (Monetization Layer)

Ryv as a hosted service can monetize agentic actions via Stripe's Agent Toolkit:
- Each autonomous fix attempt = 1 metered agent credit
- Pricing: per-fix (like Devin's $2/task model) or usage-based subscription
- `@stripe/agent-toolkit` integrates directly with LLM function calling
- Machine payments (Stripe x402) for B2B API consumers

This is a billing infrastructure concern, not a core feature. Add if/when Ryv has a hosted paid tier.

---

## What Qualifies for Autonomous Fix vs. Human Triage

Not every ticket should go to FixAgent. The TriageAgent uses these heuristics:

| Condition | Action |
|---|---|
| Blast radius <= 5 AND single file change predicted | Route to FixAgent |
| Clear stack trace pointing to 1 symbol | Route to FixAgent |
| Sentry Seer confidence > 0.75 | Route to FixAgent |
| Feature request or architectural change | Human triage, Ryv adds context comment |
| Blast radius > 10 | Human triage, Ryv posts impact analysis |
| No reproduction steps + ambiguous description | Human triage, Ryv asks clarifying questions |
| Security-sensitive path (auth, payments) | Always require human approval, never auto-merge |

---

## New Components Required

| Component | Where | Builds On |
|---|---|---|
| `TriageAgent` | `packages/reviewer/src/agents/triage.ts` | multi-agent architecture |
| `FixAgent` | `packages/reviewer/src/agents/fix.ts` | existing LLM backend |
| `PatchAgent`, `TestAgent`, `ValidationAgent` | `packages/reviewer/src/agents/` | multi-agent specialist pattern |
| `SandboxRunner` | `packages/api/src/sandbox.ts` | CI integration hook |
| `SentryAdapter` | `packages/reviewer/src/adapters/monitoring/sentry.ts` | existing ticket adapter pattern |
| `OpenReplayAdapter` | `packages/reviewer/src/adapters/monitoring/openreplay.ts` | same |
| `PagerDutyAdapter` | `packages/reviewer/src/adapters/monitoring/pagerduty.ts` | same |
| `DatadogAdapter` | `packages/reviewer/src/adapters/monitoring/datadog.ts` | same |
| `PostMergeMonitor` | `packages/api/src/post-merge-monitor.ts` | Sentry/PD webhook + pgvector writeback |
| `TicketWriteback` | extend existing adapters | G19 (`/pr_to_ticket`) |
| VCS `createBranch` + `commitPatch` | extend `packages/reviewer/src/adapters/vcs/` | existing GitHub/Azure/GitLab adapters |

---

## Build Sequence

### Phase 0 — Foundation (enables everything else)

1. **VCS adapter extensions** — `createBranch()`, `commitPatch()`, `createPR()` on GitHub + Azure + GitLab adapters. Without this, the agent can't open a PR.
2. **Ticket writeback** — extend Jira/Linear/GitHub adapters with `updateStatus()`, `addComment()`, `linkPR()`. This is G19 from v3 roadmap.
3. **SentryAdapter** — MCP-connected adapter using the official Sentry MCP server.

### Phase 1 — Core Fix Loop

4. **TriageAgent** — classifies signals, locates symbols, determines auto-fix eligibility.
5. **FixAgent** — patch generation using graph context + Sentry/OpenReplay context.
6. **SandboxRunner** — apply patch to branch, trigger CI, return pass/fail + logs.
7. **PR auto-creation** — wire TriageAgent → FixAgent → SandboxRunner → VCS adapter → PR.
8. **Self-review integration** — pass the new PR through existing `PRReviewAgent` pipeline.

### Phase 2 — Observability Bridges

9. **OpenReplayAdapter** — session replay context injected into fix prompts.
10. **PagerDutyAdapter** — incident signal intake + post-merge resolution check.
11. **PostMergeMonitor** — watches Sentry error rate post-merge, triggers revert if regression.

### Phase 3 — Intelligence Compounding

12. **Fix outcome feedback** — record patch success/failure in pgvector. FixAgent uses prior successful patches as RAG examples (mirrors existing `priorExamples` pattern for reviews).
13. **DatadogAdapter** — infrastructure metric context for latency/memory bugs.
14. **Stripe billing** (optional) — per-agent-action metered credits for hosted tier.

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| FixAgent introduces a worse bug | SandboxRunner must pass tests before PR is opened. Never auto-merge. |
| Blast radius underestimated | Blast radius guard: refuse auto-fix if > 10 callers |
| Security path touched | Hard block: auth/payment symbol paths always require human approval |
| Infinite retry loop | Max 3 FixAgent attempts per ticket. After 3, escalate to human triage |
| PR spam | Rate limit: max 5 auto-PRs open simultaneously per repo |
| Sentry/OpenReplay data is PII | Adapters must strip PII from session summaries before injecting into prompts. Configurable via `STRIP_PII=true` env var |

---

## Definition of Done

A team using Ryv in autonomous SDLC mode:

1. A Sentry P1 error fires at 3am. Ryv opens a fix PR by 3:05am with a passing test suite. On-call engineer wakes up to a ready-to-review PR, not a blank terminal.
2. A Linear ticket is created by a PM. Ryv comments within 5 minutes: "I've located the affected symbols. This is a 2-file change with blast radius 3. I'll open a draft fix." A PR appears within 20 minutes.
3. An engineer merges a fix. Sentry confirms the error rate dropped 95%. Ryv auto-closes the ticket and posts the resolution summary.
4. A ticket is too complex (blast radius 28, architectural change). Ryv comments: "This change affects 28 callers across 4 modules. I've added a blast radius analysis and test gap report. Assigning to @owner for human review."
