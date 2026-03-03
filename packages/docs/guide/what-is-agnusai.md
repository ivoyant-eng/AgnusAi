# What is Ryv?

Ryv is a fully open-source, self-hostable AI code reviewer built for teams who can't — or won't — send their source code to a third-party service.

It goes far beyond diff-level review: it builds a **symbol dependency graph** of your entire codebase, understands which callers are affected by every change, enforces your team's written standards, and runs parallel specialist agents — all inside your own infrastructure.

## The Problem with Generic AI Review

Most AI reviewers hand the LLM only the diff. That means:

- **No blast radius** — the LLM can't see which other functions call the one you just changed
- **No codebase memory** — every review starts from zero, with no team-specific context
- **No governance** — there's no way to enforce "no hardcoded secrets" or "validate inputs at boundaries" as a policy
- **High noise** — a single pass LLM over a large diff produces many low-confidence findings that slow down developers

Ryv addresses all four.

## How It Works

```
PR opened / synchronized
        │
        ▼
   Diff fetched from GitHub / Azure DevOps
        │
        ▼
   Symbol graph queried  ──→  blast radius assembled (BFS, 1–2 hops)
   pgvector queried      ──→  semantic neighbors retrieved (deep mode)
   Rules resolved        ──→  org/repo/path policies injected
   Prior examples        ──→  team-approved comments retrieved (RAG feedback)
        │
        ▼
   Specialist agents run in parallel
   security · correctness · performance · style · blast_radius
        │
        ▼
   Judge consolidates — deduplicates, ranks by severity + confidence
        │
        ▼
   Precision filter — drops comments below confidence threshold
        │
        ▼
   Inline comments posted to PR · Rule evaluations + violations saved
```

## Core Capabilities

### Graph-aware Blast Radius

Ryv parses your codebase with **Tree-sitter WASM** (no language server needed) into a symbol dependency graph stored in Postgres. On every PR, it runs BFS from changed symbols outward — injecting the affected callers, callees, and imports into the review prompt as structured context.

This means the LLM knows: _"this function is called by 12 other modules, 3 of which are in the payment flow."_

Supported languages: TypeScript, JavaScript, Python, Java, Go, C#.

### Multi-Agent Review

Instead of one LLM pass trying to catch everything, Ryv runs **parallel specialist agents** — each with a tightly focused directive:

| Agent | Focus |
|-------|-------|
| Security | Vulnerabilities, auth gaps, secrets exposure |
| Correctness | Logic errors, race conditions, edge cases |
| Performance | Complexity, N+1, hot-path issues |
| Style & Maintainability | Readability that causes future defects |
| Blast Radius | Impact on dependent callers |
| Ticket Compliance | Whether the PR matches the linked ticket |

A **judge pass** consolidates findings — deduplicating, keeping only the strongest per-location finding, and emitting a final verdict.

### Rules System

Org admins define **Rules** in plain language via the dashboard. Rules are scoped to the org, a specific repo, or a file path glob. Every review injects applicable rules into the prompt and records pass/fail evaluations with full violation history.

Example: _"No raw card numbers (PAN) may be stored or logged."_

Rules replace the need for static linter configs for policy-level standards and produce an audit trail of every evaluation and every violation that made it to production.

### Feedback Learning Loop

Every comment posted to GitHub or Azure DevOps includes 👍/👎 rating links. Developer ratings are embedded and stored in Postgres. On the next PR review, the top accepted comments for that repo are retrieved via pgvector similarity search and injected as **prior examples** — so the model progressively learns what your team considers a real finding vs. noise.

### Precision Filter

Every comment the LLM generates includes a `[Confidence: X.X]` self-assessment. The precision filter silently drops anything below the configurable threshold (default `0.7`). You see only the findings the LLM itself is confident about.

### Three Review Depths

| Depth | Graph traversal | Embeddings | Use when |
|-------|-----------------|------------|---------|
| `fast` | 1-hop BFS | No | Quick CI checks |
| `standard` | 2-hop BFS | No | Default — balanced cost/quality |
| `deep` | 2-hop BFS | pgvector semantic search | Large codebases, critical paths |

### Token Usage Tracking

Ryv tracks LLM token consumption per agent, per repository, and per day — aggregated at the org level. View usage with custom date ranges in **Settings → Token Usage** or via the API.

### Security-first Design

- **No raw source code stored** — only symbol signatures, dependency edges, and embedding vectors are persisted
- **Self-hosted** — your code never leaves your infrastructure
- **Air-gap compatible** — works entirely with local Ollama models and no external API calls
- **Rate limiting** — configurable global, auth, and webhook rate limits with proxy-aware IP detection
- **Org-scoped webhook secrets** — each org manages its own signing secrets, rotatable without redeployment

## What Ryv Is Not

- **Not a chat interface** — embeddings are for blast-radius expansion and prior-example retrieval, not Q&A
- **Not a linter replacement** — it catches semantic issues, not formatting or type errors
- **Not a substitute for human review** — it's a first-pass assistant that surfaces what matters so reviewers can focus

## Hosting

Ryv runs as a single Docker Compose stack: the API server (Fastify), Postgres with pgvector, and the React dashboard — all with `docker compose up --build`. Supports GitHub and Azure DevOps webhooks. Bring your own LLM (Ollama, OpenAI, Azure, Claude, or any OpenAI-compatible endpoint).

→ [Get started with the hosted service](/guide/hosted-setup)
