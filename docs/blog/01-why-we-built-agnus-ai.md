# Why We Built AgnusAI (And Why Existing Tools Weren't Enough)

*Part 1 of 7 in the "Building AgnusAI" series*

---

A few months ago, a senior engineer at a fintech company told me something that stuck: "We looked at every AI code review tool out there. They all require sending our code to some SaaS server. That's a non-starter. We process payments. We can't do that."

He wasn't being paranoid. He was being responsible.

That conversation was one of the final nudges that got us to build AgnusAI seriously. But honestly, the privacy problem was only half of it. The bigger problem — the one that makes AI code review fundamentally broken for most teams — is simpler and more universal than security compliance.

**Existing AI code review tools read diffs as flat text. They have no idea what your code actually does.**

---

## The Promise of AI Code Review

The pitch is compelling. Open a PR, get a review from an AI that's read millions of codebases, catches bugs you'd miss, and explains the impact clearly. Tools like CodeRabbit, GitHub Copilot PR summaries, and CodiumAI have all taken swings at this problem.

And they work — to a point. They're good at catching obvious style issues, missing error handling, and common anti-patterns. For a solo developer or a small team moving fast, they add real value.

But as soon as you're working on a mature codebase with real dependencies between modules, they start to fail in a specific, predictable way: they see the change, but not the consequences.

---

## The Blast Radius Problem

Here's a concrete example. Imagine a utility function that validates API request signatures. It's called by 40 different handlers across your codebase. A developer opens a PR that changes the function signature — adding a required parameter.

A flat-diff review sees this:

```diff
- export function validateSignature(request: Request): boolean {
+ export function validateSignature(request: Request, strictMode: boolean): boolean {
```

The AI reviews that change. It might note the new parameter. It might suggest adding a default value. What it cannot tell you is: "These 40 handlers that call this function will now throw a runtime error at the call site."

That's the blast radius problem. The change is 3 lines. The impact is 40 broken callers. Every existing AI code review tool misses this entirely because they're analyzing a text diff, not a dependency graph.

This isn't an edge case. It's the normal state of any codebase that's been in production for more than six months.

[Image]: {Side-by-side comparison diagram. Left panel labeled "Flat diff review": shows a narrow code diff block with 3 highlighted changed lines, and a simple AI comment bubble saying "Added required parameter". No other context visible. Right panel labeled "Graph-aware review": shows the same 3 changed lines, connected via orange dependency edges (#E85A1A) to 40 caller nodes arranged in a fan pattern. A comment bubble lists 5 affected callers with their file paths. Dark background #131312. Clean minimal editorial style, monospace font labels.}

---

## The Privacy Problem

Back to our fintech friend. He's not alone.

The teams that most need rigorous code review — fintech, health, defense, enterprise software — are exactly the teams that can't use existing AI review tools. Every tool on the market requires sending your source code to a third-party API: OpenAI, Anthropic, or the tool vendor's own servers.

For a team building payment processing software, or EHR systems, or anything that touches sensitive data, that's not a configuration option they can toggle. It's a compliance and IP protection issue. Their code is their product. Sending it to a SaaS review service isn't just risky — it's often explicitly prohibited by their legal and security teams.

The result: the teams with the most complex codebases, the highest stakes, and the greatest need for good code review are completely locked out of AI-assisted review.

Meanwhile, a growing cohort of engineering teams has made the move to local LLMs. They're running Ollama internally, serving Mistral or LLaMA or Code Llama on their own hardware. Zero data egress. Full control. The problem: every AI code review tool assumes you're calling an external API. There's no clean way to plug in your local model.

---

## What We Set Out to Build

We started with three non-negotiables:

**Self-hostable.** One `docker compose up` should get you a fully functional code review service. No API keys required. No data leaving your network. The entire thing — API server, graph engine, vector store — runs in your own infrastructure.

**Graph-aware.** The reviewer needs to understand your codebase, not just read the diff. That means building and querying a symbol dependency graph: which functions call which other functions, what the blast radius of a change is, what else in the codebase will be affected.

**Any LLM.** Whether you're running Ollama locally, using OpenAI's API, using Claude, or connecting to an Azure OpenAI deployment — the review logic should be identical. The LLM backend is a swappable adapter, not a dependency.

---

## The Competitive Gap

There's a reason no existing tool has all three. Self-hosting requires significant engineering investment in deployment and ops. Graph-awareness requires building a symbol parser and dependency graph, not just wrapping an LLM API call. Supporting multiple LLM backends requires resisting the temptation to tightly couple to one provider.

Here's where the market stands:

| Tool | Graph-aware | Self-hostable | Any LLM |
|------|:-----------:|:-------------:|:-------:|
| CodeRabbit | No | No | No |
| GitHub Copilot PR Review | No | No | No |
| CodiumAI | No | No | No |
| **AgnusAI** | **Yes** | **Yes** | **Yes** |

This isn't a table we made up to look good. It's the actual state of the market. No other tool sits in the top-right quadrant because each property is genuinely hard to build. Together, they're a meaningful moat.

---

## Who This Is For

The ICP is specific: **security-sensitive engineering teams who can't send code to third-party AI, and teams running local LLMs who want graph-aware review.**

In practice that's:
- Fintech teams under SOC2, PCI-DSS, or GDPR constraints
- Health tech teams under HIPAA
- Defense contractors with air-gapped environments
- Enterprises with internal LLM deployments (Ollama, Azure OpenAI private endpoints)
- Any team that's been burned by "this looks fine" reviews that missed a broken caller tree

These teams aren't price-sensitive. They're constraint-sensitive. They need a tool that works in their environment, not a tool that requires them to change their security posture to use.

---

## What We Actually Built

Over roughly 7 days (101 commits, Feb 17–24, 2026), we went from a single TypeScript script to a full hosted service with:

- A unified LLM backend that supports Ollama, OpenAI, Claude, and Azure OpenAI through a single interface
- A symbol dependency graph built on Tree-sitter WASM — no native compilation, works in any environment
- Three review depths: Fast (1-hop BFS), Standard (2-hop), and Deep (2-hop + pgvector semantic search)
- A Fastify API server with GitHub and Azure DevOps webhook support
- A React dashboard with real-time indexing progress via SSE
- A precision filter that makes the LLM self-assess its own confidence before comments are posted
- A RAG feedback loop that injects past developer-approved comments as examples for future reviews

The rest of this series documents how each of those pieces was built, the decisions we made and discarded, and why we think graph-aware code review is a fundamentally different category from what exists today.

---

## What's Next

In the next post, we'll walk through the first three days of building: how a single hardcoded TypeScript script became a structured architecture with a unified LLM backend, VCS adapters, and the `PRReviewAgent` orchestrator. We'll cover what we tried first (including the Vercel AI SDK, which we threw away), what crystallized quickly, and the moment we realized the real problem wasn't the LLM — it was everything around it.

---

*Next: [Day 1–3: From a Python Script to a Unified LLM Backend →](./02-day-1-3-unified-llm-backend.md)*
