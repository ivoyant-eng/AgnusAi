# Plan: Multi-Agent Specialized Review Architecture (G4)

> Priority: High (Recall + Precision uplift)
>
> **Status: ✅ Shipped** — see `packages/reviewer/src/review/multi-agent.ts` and `packages/docs/reference/multi-agent.md` for current state
>
> Roadmap ref: `docs/roadmap/v3-competitive.md#G4`

## Objective

Move from single-pass review to a parallel specialist architecture with a consolidation judge so AgnusAI catches more real issues with lower noise.

Target outcome:

- Higher recall on security/correctness/performance defects
- Better precision via dedup + judge filtering
- Tunable cost/latency by provider and concurrency

## What We Learned (Industry Patterns)

Common winning architecture across modern agent stacks:

- Context collector first (shared normalized context)
- Parallel specialist agents (small focused prompts)
- Judge/consolidator for dedup, ranking, and verdict
- Explicit observability per agent (latency/tokens/yield)

This aligns with:

- Qodo’s specialized-agent + context collector + consolidation model
- LangChain/LangGraph supervisor/worker multi-agent patterns
- AutoGen-style multi-agent conversation and orchestration

## Scope for AgnusAI v1

### In scope

- Specialist agents run in parallel
- Context collector to build per-agent inputs
- Judge pass for dedup + conflict resolution + final verdict
- Feature-gated rollout (`REVIEW_MODE`)
- Cost/latency instrumentation

### Out of scope (v1)

- Cross-review memory per agent
- Agent fine-tuning/custom models per domain
- Human-in-the-loop orchestration in UI

## Proposed Agent Set (v1)

- `security`
- `correctness`
- `performance`
- `style_maintainability`
- `ticket_compliance` (enabled only when ticket context exists)
- `blast_radius` (enabled only when graph context exists)

## Target Pipeline

1. Context Collector

- Normalize diff, graph, rules, ticket data
- Produce domain-scoped context slices to reduce prompt size

1. Parallel Agent Execution

- Fan out enabled specialists with bounded concurrency
- Continue on partial failure (`allSettled` semantics)

1. Judge Consolidation

- Merge comments
- Deduplicate near-identical findings (path+line+semantic similarity)
- Resolve conflicts (e.g., style disagreement vs correctness risk)
- Produce final verdict + summary

1. Post-processing

- Existing confidence filter remains
- Persist per-agent telemetry and final kept/dropped decisions

## Interfaces (shared types)

Add shared types for:

- `AgentRole`
- `AgentInput`
- `AgentOutput`
- `ConsolidatedReview`
- `AgentTelemetry`

Include mandatory fields:

- `source_agent`
- `confidence`
- `evidence`
- `tokens_used`
- `duration_ms`

## Prompt Strategy

- Keep prompts role-pure (security agent must not produce style comments)
- Inject only relevant rules subset by category/scope
- Use compact, structured output schema for parser stability

## Orchestration and Concurrency

Config:

- `REVIEW_MODE=fast|thorough|auto`
- `ENABLED_AGENTS=...`
- `AGENT_CONCURRENCY=<n>`
- `JUDGE_ENABLED=true|false`

Default policy:

- Ollama/self-hosted local: `fast` or `thorough` with low concurrency (`1`)
- Cloud models: `thorough` with concurrency `3-4`

## Rollout Plan

### Phase 0: Baseline and Evaluation Harness (3-4 days)

- Create fixed benchmark set from historical PRs (accepted/rejected outcomes)
- Define scorecards: precision, recall, F1, latency, cost

Acceptance:

- reproducible benchmark script and baseline numbers for single-agent mode

### Phase 1: Agent Contracts + Collector (4-5 days)

- Implement types + collector + role-specific context builders
- Add config flags and no-op orchestrator wiring

Acceptance:

- typed inputs generated for each agent role without behavior change

### Phase 2: Parallel Specialists (5-7 days)

- Implement specialist executors and orchestrator
- Add retries/timeouts/circuit breaker per agent

Acceptance:

- end-to-end PR review returns merged output from multiple agents
- no total failure if one agent crashes/timeouts

### Phase 3: Judge + Dedup (4-6 days)

- Add judge ranking, dedup, conflict resolution
- Add score-threshold filtering before final verdict

Acceptance:

- duplicate comment rate reduced vs phase 2
- precision improves on benchmark set

### Phase 4: Observability + Cost Controls (3-4 days)

- Persist per-agent telemetry and judge decisions
- Add logging and dashboard counters (agent latency/tokens/kept-rate)

Acceptance:

- clear per-agent ROI visibility
- configurable caps prevent runaway token usage

### Phase 5: Gradual Production Rollout (4-6 days)

- Canary by org/repo
- A/B single-agent vs multi-agent
- default switch when SLOs are met

Acceptance:

- target uplift achieved without latency/cost regression beyond agreed budget

## Quality Gates

Before defaulting to multi-agent:

- Recall uplift >= 10% on benchmark corpus
- Precision non-decreasing (or <=2% drop with documented tradeoff)
- p95 latency within configured budget
- Token cost increase within budgeted factor

## Risks and Mitigations

- Latency/cost blow-up
  - mitigate with concurrency limits, short prompts, optional agent sets
- Conflicting findings between agents
  - mitigate with judge conflict policy and source attribution
- Prompt drift and parser fragility
  - mitigate with strict output schema and contract tests

## Dependency on G3 Rules System

G4 should consume G3 outputs:

- Context collector injects scoped rules per agent
- Judge prioritizes rule-backed findings
- Analytics can compare rule-driven vs non-rule findings

## Implementation Sequence Recommendation

1. Finish G3 Phase 1-3 first (rules + enforcement + suggestions)
2. Start G4 Phase 0-2 (collector + specialists)
3. Add judge and observability
4. Run controlled rollout and flip defaults by provider

## References

- Qodo roadmap context and docs: [https://docs.qodo.ai/qodo-documentation/code-review/get-started/rule-enforcement](https://docs.qodo.ai/qodo-documentation/code-review/get-started/rule-enforcement)
- LangChain multi-agent patterns: [https://docs.langchain.com/oss/python/langchain/multi-agent](https://docs.langchain.com/oss/python/langchain/multi-agent)
- AutoGen framework paper: [https://arxiv.org/abs/2308.08155](https://arxiv.org/abs/2308.08155)

