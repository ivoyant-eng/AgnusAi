# How We Fixed LLM Hallucination and the Context Problem with Multi-Agent Architecture

*Part 9 of the "Building AgnusAI" series*

---

[Image]: {A lone robot sitting at a desk surrounded by towering stacks of paper, frantically trying to read all of them at once. The papers are labeled things like "security concerns," "performance issues," "style violations," "blast radius," "ticket compliance." The robot looks overwhelmed, eyes wide, papers flying everywhere. Dark editorial illustration style, muted tones, single orange accent light.}

There's a specific moment in every LLM-powered product's life where you realize the thing you built works — just not well enough.

For us, it was a Tuesday afternoon. We had a PR open against the payments module. AgnusAI reviewed it. The review came back with eight comments. Three were about variable naming. Two were about a missing null check we'd already handled three files up the call chain. One flagged a security issue that was actually the correct behavior for that particular API. One was genuinely useful. One was hallucinated from thin air — a reference to a function that didn't exist in the codebase.

Eight comments. One useful. That's a 12.5% hit rate. You can flip a coin and do better than that over a large enough PR.

We knew what the problem was. We just didn't know how bad it had gotten until we saw it in production against real code.

---

## The Naive Approach (And Why It Breaks)

The original AgnusAI review loop was deceptively simple. You'd feed it a diff, attach some graph context (caller/callee relationships, blast radius), sprinkle in some prior feedback examples, and then send the whole thing to the LLM with a single prompt that said, roughly: *"Here is this PR. Find all the problems."*

[Image]: {A single large funnel with a massive pile of code, diff output, graph data, and ticket text being poured into the top. Out of the narrow bottom comes a small, sad stream of comments. Some of the comments are question marks. One is clearly labeled "hallucination." The image should feel like something is being lost or corrupted in the process. Technical illustration style, blueprint aesthetic.}

That approach has a fundamental cognitive problem. Imagine asking a single person to simultaneously be:

- A security auditor reviewing authentication flows
- A performance engineer analyzing hot paths and N+1 queries
- A senior engineer thinking about architectural blast radius
- A product manager checking whether the PR matches the ticket
- A code style enforcer looking at readability

No single human does all of this well at the same time. Cognitive load forces trade-offs. When you're thinking hard about SQL injection, you're not thinking hard about whether the function name is misleading. When you're counting hops in a blast radius BFS, you're not scanning for race conditions.

LLMs have the same problem. A single pass over a large diff with a generic "find everything wrong" instruction produces an output that is *superficially thorough but actually unfocused*. The model tries to do everything and ends up doing nothing particularly well. Context bleeds across concerns. A half-formed thought about security contaminates the performance analysis. Style observations crowd out correctness findings.

The result is exactly what we saw: a high comment count that hides a terrible precision rate.

---

## The Context Window Tax

The second problem is more subtle, and it took us longer to name it.

When you stuff a 500-line diff, a graph context blob, a rules list, prior feedback examples, and a full system prompt into one context window, something happens: **the model starts paying less attention to the parts that matter most.**

This isn't a capability limitation. Modern LLMs have large context windows. The issue is *attention distribution*. A 128K token context window doesn't mean the model reads every token with equal care. Research on attention patterns (and our own empirical testing) shows that models systematically underweight information in the middle of long prompts. They tend to anchor on the beginning and the end.

So the blast radius data you injected at position 40,000 tokens? It might as well not be there. The security rules you listed in the middle of the system prompt? The model saw them, acknowledged them, and then when generating the review, forgot to apply them to token 47,000 where the vulnerable code actually lives.

We were paying a context window tax every single review and getting nothing back for it.

[Image]: {A visualization of an LLM attention map over a very long document. The beginning and end glow bright orange. The middle is dim and gray. Key pieces of information in the middle are circled in red with the label "model isn't looking here." Data-visualization aesthetic, dark background, orange accent color.}

---

## The Insight: Divide the Problem

The fix, when we finally arrived at it, felt obvious in retrospect. All the best AI architectures for complex multi-step reasoning had already figured it out:

**Don't ask one agent to do everything. Build specialist agents, each responsible for exactly one thing, running in parallel.**

It's the same insight that makes human engineering teams effective. You don't ask your best security engineer to also do all your performance optimization. You build a security team, a platform team, and a product team — each with their own vocabulary, their own checklists, their own signal patterns — and then you have a staff meeting where they share findings.

We did the same thing for code review.

---

## Meet the Agents

[Image]: {Five distinct robotic characters standing in a lineup, each with a unique design reflecting their specialty. Security agent in dark armor with a shield. Correctness agent with precise measuring tools and a checklist. Performance agent in a racing suit with speed metrics on a visor. Style agent with an editorial aesthetic, holding a red pen. Blast Radius agent in an explorer's gear, looking outward at a sprawling dependency map. The characters look like a specialized team, not identical copies. Flat illustration style, each character lit with the orange AgnusAI accent color.}

We shipped six specialist agents, each given a tightly scoped directive and only the context slices relevant to their domain:

**Security** — Focuses exclusively on vulnerabilities: authentication gaps, secrets exposure, injection vectors, broken access control. Its prompt contains only security-relevant rules, no performance context. It doesn't know or care about naming conventions.

**Correctness** — Logic errors, edge case handling, race conditions, off-by-one errors, null safety. This agent asks: "Is this code doing what the author thinks it's doing?"

**Performance** — Algorithmic complexity, N+1 queries, hot-path allocations, cache misses. The performance agent sees the blast radius data because it needs to know if a slow path is called by 200 callers.

**Style & Maintainability** — Readability issues that create future defects. Not formatting (that's a linter's job), but naming that misleads, abstractions that leak, comments that contradict the code.

**Blast Radius** — The agent that only AgnusAI can field. It receives the full symbol dependency graph for the changed files — callers, callees, transitive impact — and its only job is to answer: "Who breaks if this change is wrong?" It finds the payment processor calling the function you just refactored. It finds the mobile client depending on the API contract you silently changed.

**Ticket Compliance** — When a linked Jira or Azure Boards ticket exists, this agent checks whether the PR actually matches what was asked for. It catches scope creep and missing requirements before review.

Each agent's prompt is constructed to be *role-pure*. The security agent doesn't produce style comments. The style agent doesn't speculate about blast radius. We enforced this through explicit negative constraints in each system prompt — "you are a security reviewer. Do not comment on performance, style, or code organization unless it has a direct security implication."

---

## Running in Parallel

[Image]: {Six parallel pipeline tracks running simultaneously, each labeled with an agent name. Each track takes in a shared "context slice" on the left and produces a stream of findings on the right. The tracks are visually independent — different colors, different widths reflecting different output volumes. They converge at a single "consolidation" node on the right. Industrial process diagram aesthetic, dark background, orange pipeline highlights.}

The agents run concurrently via `Promise.allSettled`. That last word matters: not `Promise.all`. We use `allSettled` because we explicitly want partial results. If the performance agent times out on a massive diff, the security findings still ship. If the blast radius agent encounters an unindexed repo, the correctness review isn't held hostage.

Each agent is time-boxed. Each agent is given a targeted context slice rather than the full prompt. The security agent doesn't see the style rules. The correctness agent doesn't get the token usage data. By narrowing each agent's context to what it actually needs, we:

1. Reduced average prompt size per agent by ~60% compared to the single-pass prompt
2. Eliminated cross-domain attention bleed
3. Made each agent's output structurally predictable (it can only see what we gave it)

The wall-clock cost — in both time and tokens — is lower than you'd expect. Because each individual prompt is shorter, agents finish faster. And the parallelism means the total latency is bounded by the slowest agent, not the sum of all agents.

---

## The Judge Pass

Running parallel specialists solves the coverage problem. It creates a new one: overlap.

Both the security agent and the correctness agent might flag the same null dereference. The style agent might comment on a function name that the correctness agent already flagged as misleading. Without consolidation, you'd post the same finding three times and the developer would lose trust immediately.

[Image]: {A judge character sitting at an elevated bench, reviewing six stacks of reports from the specialist agents. The judge is crossing out duplicates with a red pen, highlighting the strongest findings in orange, and assembling a final clean report. Law-court aesthetic mixed with software engineering — the gavel is shaped like a compiler, the reports have code diffs on them. Warm editorial illustration style.}

The judge pass runs after all agents complete. It receives every finding from every agent and does three things:

**Deduplication** — Findings at the same file and line are collapsed. We keep the strongest formulation: the one with the highest confidence score, the most specific evidence, the most actionable suggestion.

**Conflict resolution** — Occasionally two agents disagree. The security agent says "this input is unvalidated and dangerous." The correctness agent says "this validation is actually correct given the upstream context." The judge resolves based on scope: the correctness agent has more context about the specific function, so its assessment wins for correctness issues; the security agent's assessment wins for anything touching authentication or data exposure regardless.

**Final verdict** — The judge emits a single `approve`, `comment`, or `request_changes` verdict that synthesizes all findings. If the security agent flagged a critical vulnerability, the verdict is `request_changes` regardless of whether the style review was positive.

In deterministic judge mode (the default), this is rule-based logic — no additional LLM call, no additional latency, no additional cost. In LLM judge mode (opt-in), the consolidation itself is an LLM pass that can reason about subtle relationships between findings. We found deterministic to be sufficient for 95% of cases and meaningfully cheaper.

---

## What Changed After Shipping

The difference was immediate and measurable.

Before multi-agent, a typical PR review on a medium-complexity diff produced 8–12 comments, of which roughly 30–40% were genuinely actionable. Developers started skimming reviews within the first week.

After multi-agent with the judge pass, the same PR produced 3–5 comments. Every one of them was from a specialist who had looked at nothing but that category of problem. The precision rate on our internal benchmark set went from ~35% to ~78%.

More importantly: developer behavior changed. People started reading reviews again. We got reports of the blast radius agent surfacing callsite regressions that would have shipped to production. The correctness agent catching a race condition in a lock implementation. The security agent flagging a JWT secret that had been hardcoded in a test helper and then copy-pasted into a production path.

These were findings that the single-pass model had generated before, too — and buried in a list of nine other comments where they'd been ignored.

[Image]: {A before-and-after comparison. Left side: a cluttered PR review thread with 11 comments, many with question marks or crossed out, one highlighted in orange labeled "the only real issue." Right side: a clean PR review thread with 4 comments, each with a clear agent attribution badge (Security, Correctness, Blast Radius, Performance), all in orange highlight. The right side looks authoritative and focused. Split-panel editorial illustration style.}

---

## The Architecture in Production

The system as it runs today:

```
PR Opened / Synchronized
       │
       ▼
  Context Collector
  ┌─────────────────────────────────────────┐
  │  diff + graph BFS + rules + RAG examples│
  │  sliced per-agent domain                │
  └─────────────────────────────────────────┘
       │
       ▼  Promise.allSettled (bounded concurrency)
  ┌──────────┐  ┌─────────────┐  ┌─────────────┐
  │ Security │  │ Correctness │  │ Performance │
  └──────────┘  └─────────────┘  └─────────────┘
  ┌─────────────────────┐  ┌──────────────────────┐
  │ Style/Maintainability│  │   Blast Radius       │
  └─────────────────────┘  └──────────────────────┘
       │
       ▼
  Judge Pass
  (dedup + conflict resolution + verdict)
       │
       ▼
  Precision Filter
  (drops findings below confidence threshold)
       │
       ▼
  Inline comments posted to PR
  Rule evaluations + violations saved to DB
  Per-agent telemetry recorded
```

Each agent's token usage, latency, comment count, and verdict are stored in the `review_agent_telemetry` table. You can see, per repository, which agents are producing findings and which are consistently coming back empty. If the blast radius agent has a 0% yield rate on a repo, it's a signal that the repo hasn't been indexed — not that the code is safe.

---

## What We Got Wrong (And Fixed)

The first version of the agent prompts had no negative constraints. We told each agent what to look for but not what to *ignore*. The result was cross-contamination: the security agent would occasionally produce a correctness comment. The style agent would sometimes speculate about performance.

We fixed this by making the negative instructions as explicit as the positive ones: *"You are a correctness reviewer. Do not comment on code style, variable naming, performance optimization, or security vulnerabilities unless they are a direct cause of incorrect behavior."*

The second mistake was giving every agent the full graph context. The style agent does not need to know that `processPayment()` is called by 40 other functions. Narrowing context per agent wasn't just a correctness improvement — it measurably reduced hallucination rates. Agents hallucinate less when they have less irrelevant context to get confused by.

The third mistake was running with a single level of concurrency on Ollama-backed deployments. Local models don't have the parallelism of cloud APIs. Running five agents simultaneously against a local Ollama instance caused memory contention and made each agent slower than running them sequentially. We added a configurable `AGENT_CONCURRENCY` cap, defaulting to 1 for local deployments and 3-4 for cloud-backed ones.

---

## The Broader Lesson

[Image]: {A wide aerial view of a city where each district is specialized — a financial district, a hospital quarter, an industrial zone — connected by clean roads to a central council chamber where representatives from each district meet to make decisions. The city is organized, productive, clearly zoned. Contrast it with a small inset showing the "before" state: one person trying to run the entire city alone, overwhelmed. Illustrated map aesthetic, editorial style, orange accent on the central council chamber.}

Multi-agent architecture is not a complexity trade-off you make because you want to write more code. It's a cognitive architecture decision. The question it answers is: *what is the right unit of specialization for this problem?*

For code review, the unit is the concern category. Security is a different lens from correctness. Blast radius is a different lens from style. The information each lens needs is different. The signal each lens produces is different. Trying to collapse all of them into one pass because it's simpler is the same mistake as hiring one generalist instead of a team — except the generalist in this case doesn't get tired, doesn't push back, and will confidently produce twelve comments even if only one of them is real.

The parallelism is a performance benefit. The judge pass is a precision mechanism. But the core insight is older than LLMs:

**A specialist with a focused brief outperforms a generalist with a vague one. Every time.**

---

*AgnusAI is open-source and self-hostable. The multi-agent review system runs on any LLM — Ollama locally, or OpenAI, Claude, and Azure OpenAI in the cloud. Try it: [github.com/ivoyant-eng/AgnusAi](https://github.com/ivoyant-eng/AgnusAi)*
