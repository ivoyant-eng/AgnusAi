# v5 Roadmap — Autonomous SDLC: From Code Reviewer to Engineering Agent

> **Status:** Exploratory — not committed
> **Premise:** v4 makes Ryv proactive within the codebase. v5 makes Ryv an active participant in the full software development lifecycle — from ticket intake through production monitoring and back.
> **v4 premise:** Health reports, MCP server, VS Code extension, cross-repo graph, and auto best practices distillation are all shipped.

---

## The Version Progression

```
v2  →  Ryv understands your codebase graph
v3  →  Ryv acts on every PR (review, test gen, fix, CI analysis, rules)
v4  →  Ryv works proactively, across repos, without needing a PR trigger
v5  →  Ryv participates in the full SDLC: ticket → code → PR → review → monitor → fix
```

The shift from v4 to v5 is the shift from **proactive teammate** to **autonomous engineering agent**.

In v4, Ryv watches and reports. In v5, Ryv executes.

---

## What v4 Still Doesn't Do

After v4 is fully shipped, three gaps remain in the SDLC:

**1. Ryv cannot act on a ticket without a PR already existing.**
Ryv can read ticket context and check PR compliance. But if a ticket exists and no PR has been opened, Ryv does nothing. The gap between "ticket assigned" and "PR opened" is entirely manual.

**2. Ryv has no production signal.**
When a bug ships to production — Sentry fires, PagerDuty pages, Datadog spikes — Ryv is silent. The root cause analysis, symbol location, fix generation: all manual. Ryv has the exact graph and LLM infrastructure needed to automate this, but no intake path from production observability tools.

**3. The fix loop is not closed.**
Ryv reviews PRs and suggests fixes. But it cannot verify whether its own suggestions were correct after merge. It cannot watch for regression. The feedback between "fix merged" and "production confirms resolution" is missing.

v5 addresses all three.

---

## Theme 1 — Autonomous Fix Agent

> Ryv takes a ticket and opens a production-ready PR.

### 1.1 The FixAgent Pipeline

Full detail in `docs/plans/autonomous-sdlc-agent.md`. Summary:

```
Signal (ticket / Sentry error / incident)
  → TriageAgent: locate symbols, classify, eligibility check
  → FixAgent: patch generation with graph + error + session context
  → SandboxRunner: apply patch, run tests, validate syntax
  → PR Creator: branch + commit + PR via VCS adapter
  → Self-Review: PRReviewAgent reviews Ryv's own fix PR
  → Ticket Writeback: status update + PR link on Jira/Linear/GitHub
```

Human role: approve or reject the PR. Everything else is automated.

### 1.2 Triage Intelligence

The TriageAgent classifies every incoming signal and decides whether it is auto-fix eligible:

- Blast radius <= 5 and single-file prediction → auto-fix
- Clear stack trace to 1 symbol → auto-fix
- Sentry Seer confidence > 0.75 → auto-fix
- Feature request / architectural change → human triage + Ryv context comment
- Security-sensitive path (auth, payments) → always human approval, never auto-merge
- Blast radius > 10 → human triage + Ryv impact analysis

This ensures Ryv only creates PRs it can confidently execute. Low-confidence cases get context enrichment, not noise.

### 1.3 Ticket Writeback (completing G19 from v3)

Every action Ryv takes is reflected back on the originating ticket:
- "Located 2 affected symbols. Opening fix branch." (immediately on intake)
- "PR #47 opened. Tests passing. Awaiting your review." (after PR created)
- "PR merged. Sentry confirms error resolved." (after post-merge check)
- "Escalating: blast radius 23. Adding impact analysis and assigning to @owner." (when declining to auto-fix)

Extends existing Jira/Linear/GitHub/Azure Boards adapters.

---

## Theme 2 — Observability Bridges

> Ryv sees production. Production signals become first-class fix triggers.

### 2.1 Sentry MCP Integration

Sentry's official MCP server (`mcp.sentry.dev`) is the highest-priority integration. It provides:
- Full stack traces with file + line mapped directly to Ryv's symbol graph
- Regression information: which commit introduced the error
- Sentry Seer AI analysis: root cause + fix recommendation
- Error frequency, affected users, release context

When a P0/P1 Sentry issue fires, Ryv's TriageAgent is triggered. The stack trace is resolved against the symbol graph to produce a precise blast radius analysis. The FixAgent receives the Sentry error context in its prompt.

**Implementation:** New `SentryAdapter` class following the existing ticket adapter interface. Webhook endpoint for Sentry alerts. Optional: Sentry Seer recommendations injected into fix prompt alongside Ryv's own graph analysis.

### 2.2 OpenReplay MCP Integration

OpenReplay is the open-source, self-hostable session replay platform — a natural fit for Ryv's self-hosted ICP. Its MCP server provides:
- User journey analysis: the sequence of actions leading to the error
- Problem detection: rage clicks, form abandonment, console errors
- AI session summaries: what the user was doing in plain language

When a Sentry error has an associated OpenReplay session ID (they share session IDs natively), Ryv fetches the session summary and injects it as a `## User Journey to Error` section in the FixAgent prompt.

This gives the fix agent behavioral context that a stack trace alone cannot provide. "User clicked Checkout 3 times → error on third click" is a meaningful fix hint that the stack trace doesn't contain.

**Implementation:** `OpenReplayAdapter` querying the community MCP server. Opt-in via `OPENREPLAY_URL` env var (self-hosted instance).

### 2.3 PagerDuty MCP Integration

PagerDuty's MCP server (GA on Professional+ plans) connects incident data directly to Ryv:
- Incident severity, affected service, on-call context, runbook links
- Historical incident patterns for a service
- SRE Agent integration for automated diagnostics

A PagerDuty incident becomes a TriageAgent trigger. Post-merge, Ryv watches for PagerDuty incident resolution as the primary success signal.

### 2.4 Datadog MCP Integration (Optional)

For infrastructure-correlated bugs (latency spikes, memory leaks, connection pool exhaustion):
- Metric anomaly correlated to a specific commit
- APM traces linking to source code
- Service dependency maps

Injects infrastructure context into FixAgent prompts for performance bugs. Optional — teams without Datadog skip this entirely.

---

## Theme 3 — Post-Merge Intelligence Loop

> Ryv knows whether its fixes worked.

### 3.1 Post-Merge Monitor

After a Ryv-authored fix PR is merged:
1. Watch the originating Sentry issue: does error rate drop within 60 minutes?
2. Watch PagerDuty: does the incident close?
3. If resolution confirmed: write `resolved by #PR` back to the ticket, close it, record success in pgvector
4. If regression detected (error rate unchanged or new error on same symbol): open a revert PR + new incident ticket automatically

This closes the observability loop that is currently entirely absent in Ryv.

### 3.2 Fix Quality Feedback

Successful and failed fix attempts are stored in pgvector alongside the original diff and context. Future FixAgent invocations retrieve similar past fixes as `priorExamples` (mirrors the existing review RAG feedback loop).

Over time: Ryv's fix quality improves on the same codebase without retraining.

### 3.3 Incident Pattern Distillation

Monthly scheduled job (mirrors v4's Auto Best Practices Distillation):
1. Cluster successful fix PRs by affected symbol patterns
2. For clusters of 3+ similar fixes, propose a new preventive rule: "Always validate null before calling `.process()` on CartItem — caused 3 incidents in 60 days"
3. Engineer approves → rule enters the rules system → future PRs are flagged before the pattern reaches production

This converts incident history into prevention rules automatically.

---

## What This Unlocks That No Current Tool Does

| Capability | Ryv v5 | Devin/Copilot Agent | Sentry | Linear |
|---|---|---|---|---|
| Fix from Sentry error with graph context | Yes | No (no symbol graph) | Error analysis only | No |
| Self-review own fix PR | Yes | No | No | No |
| Session replay injected into fix prompt | Yes | No | No | No |
| Blast radius guard on auto-fix | Yes | No | No | No |
| Post-merge regression monitoring | Yes | No | Partial (error tracking) | No |
| Incident → fix → ticket close in one loop | Yes | No | No | No |
| Self-hosted, air-gapped, Ollama | Yes | No | Cloud-only | Cloud-only |

Ryv's symbol graph is the differentiator here. Every competitor (Devin, GitHub Copilot Agent, SWE-agent) generates fixes without knowing the blast radius of the changed symbol, without knowing which callers need to be checked, and without graph-scoped pattern search. Ryv's FixAgent starts from a richer codebase model than any of them.

---

## v5 Feature Priority Matrix

| # | Feature | Theme | Effort | Impact |
|---|---|---|---|---|
| 1 | VCS adapter extensions (`createBranch`, `commitPatch`, `createPR`) | Fix Agent | Small | Critical — blocks everything |
| 2 | Ticket writeback (G19 from v3) | Fix Agent | Small | High |
| 3 | Sentry MCP adapter | Observability | Small | High |
| 4 | TriageAgent | Fix Agent | Medium | High |
| 5 | FixAgent (patch + test + validation) | Fix Agent | Large | High |
| 6 | SandboxRunner (CI bridge) | Fix Agent | Medium | High |
| 7 | Self-review of fix PR | Fix Agent | Small (reuse PRReviewAgent) | High |
| 8 | OpenReplay MCP adapter | Observability | Small | Medium |
| 9 | PagerDuty MCP adapter | Observability | Small | Medium |
| 10 | PostMergeMonitor | Feedback | Medium | High |
| 11 | Fix quality RAG feedback | Feedback | Small (reuse pgvector pattern) | Medium |
| 12 | Incident pattern distillation | Feedback | Medium | Medium |
| 13 | Datadog MCP adapter | Observability | Small | Low-Medium |
| 14 | Stripe agent billing (hosted tier) | Monetization | Medium | Medium |

---

## Suggested Build Sequence

### Sprint 0 — Unblock the Fix Loop (no new infrastructure)

1. `createBranch()` + `commitPatch()` + `createPR()` on existing VCS adapters
2. Ticket writeback (`updateStatus()`, `addComment()`, `linkPR()`) on existing ticket adapters
3. `SentryAdapter` — MCP-connected, single file

These three unblock everything else and require zero new data model work.

### Sprint 1 — Core Fix Agent

4. `TriageAgent` — symbol location + eligibility check
5. `FixAgent` — patch generation with graph + Sentry context
6. `SandboxRunner` — CI trigger via GitHub Actions / webhook
7. End-to-end: Sentry error → FixAgent → PR → self-review

### Sprint 2 — Observability Depth

8. `OpenReplayAdapter` — session context in fix prompts
9. `PagerDutyAdapter` — incident intake + post-merge check
10. `PostMergeMonitor` — regression detection + auto-revert

### Sprint 3 — Intelligence Compounding

11. Fix quality feedback to pgvector
12. Incident pattern distillation → rule proposals
13. `DatadogAdapter` (optional, for infra-heavy teams)

---

## What NOT to Build in v5

| Feature | Why Not |
|---|---|
| Auto-merge without human approval | Never. Even for P0 hotfixes. Human is always in the loop for merge. |
| Auto-deploy to production | Out of scope. Ryv is a code intelligence layer, not a deployment platform. |
| Direct database mutation agents | Ryv only operates on code. Schema changes, data migrations: human territory. |
| Slack chatbot for fix requests | MCP server (v4) covers conversational use cases from Cursor/Claude Desktop. |
| Custom ML model for patch generation | LLM + graph RAG is the right approach. Fine-tuning is not worth the infra. |

---

## One-Line Positioning Update

```
v4:  "The AI that knows your codebase better than any individual engineer."
v5:  "The AI engineering agent that takes a ticket at 3am and has a fix PR ready when you wake up."
```

---

## Definition of Done for v5

1. A Sentry P1 fires. Ryv opens a passing fix PR within 10 minutes without human involvement.
2. A Linear ticket is assigned. Ryv posts a symbol impact analysis + draft fix within 30 minutes.
3. An engineer approves the fix PR. Ryv confirms resolution via Sentry, closes the ticket, and stores the fix pattern.
4. A fix regression is detected. Ryv opens a revert PR automatically and re-opens the incident ticket.
5. After 3 months: the fix quality RAG loop visibly improves fix acceptance rate. Incident patterns have generated 2+ new preventive rules.

At v5 complete, Ryv is not a tool engineers invoke. It is a continuous engineering process that runs alongside the human team.
