# Architecture Overview

## High-Level System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                           │
│              node dist/cli.js review --pr 123 ...               │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                        PRReviewAgent                             │
│   - Orchestrates VCS, LLM, Skills, and Checkpoint               │
│   - Handles incremental diff fetching                           │
│   - Coordinates deduplication and comment posting               │
└──────────────────────────────────────────────────────────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌────────────┐ ┌─────────────┐ ┌──────────┐ ┌──────────────────┐
│VCS Adapters│ │ LLM Backend │ │  Skills  │ │   Checkpoint     │
│            │ │             │ │  Loader  │ │   Manager        │
│ - GitHub   │ │ Vercel AI   │ │          │ │                  │
│ - Azure    │ │ SDK         │ │ Glob     │ │ Incremental SHA  │
│   DevOps   │ │ ┌─────────┐ │ │ pattern  │ │ tracking via PR  │
└────────────┘ │ │prompt.ts│ │ │ matching │ │ comment metadata │
               │ └─────────┘ │ └──────────┘ └──────────────────┘
               │ ┌─────────┐ │
               │ │parser.ts│ │
               │ └─────────┘ │
               │ Ollama      │
               │ Claude      │
               │ OpenAI      │
               │ Azure       │
               │ Custom      │
               └─────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Comment Manager                              │
│  - Deduplication (same-line, dismissed, fixed, binary, locks)   │
│  - Post inline comments with severity + steps + AI prompt       │
│  - Post general summary comment                                  │
│  - Verdict: approve | request_changes | comment                 │
│  - Azure DevOps vote (approve / waiting for author)             │
└──────────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Webhook Handler (GitHub)                       │
│  - Listens for pull_request_review_comment events               │
│  - Builds thread history context                                 │
│  - LLM generates contextual reply                               │
│  - Posts reply via GitHub API                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
PR opened / updated
        │
        ▼
1. Fetch PR Data                    GitHub / Azure DevOps API
   - PR metadata (title, branches)
   - Diff (computed via LCS for Azure)
   - Changed file list
        │
        ▼
2. Build Context
   - Filter ignored paths
   - Match skills to file types
   - Optional: checkpoint diff (incremental only)
        │
        ▼
3. Generate Review                   Unified LLM Backend (Vercel AI SDK)
   - buildReviewPrompt(context)      → prompt.ts (shared)
   - provider.generate(prompt)       → API call
   - parseReviewResponse(response)   → parser.ts (shared)
        │
        ▼
4. Validate + Deduplicate Comments
   - Normalise paths (strip leading /)
   - Match against actual diff file list
   - Filter: same-line dup, dismissed, binary, generated, version claims
        │
        ▼
5. Post Review                       GitHub / Azure DevOps API
   - Inline comment per file+line
   - General summary comment
   - Verdict / vote
        │
        ▼
6. Update Checkpoint
   - Store SHA + reviewed files in PR comment metadata
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `BaseLLMBackend` abstract class | `prompt.ts` and `parser.ts` are shared — adding a new provider requires only implementing `generate()` |
| LCS-based diff for Azure DevOps | Azure DevOps API doesn't return unified diffs; file content at source/target commits is fetched and diffed locally |
| Path normalisation in `postReview` | Azure DevOps paths have a leading `/`; LLM output may omit it — normalised paths are validated against the actual diff file list before posting |
| LLM generates full markdown body | The LLM writes the entire comment directly — no template stitching; avoids reliability issues with local models |
| Checkpoint in PR comment metadata | Incremental state is stored as an HTML comment in the PR itself, requiring no external database |
| Pipeline-triggered model | Runs as a single-shot CLI process — no idle costs, no state management, scales with CI runners |

## Project Structure

```
AgnusAi/
├── src/
│   ├── index.ts                    # PRReviewAgent — main orchestrator
│   ├── cli.ts                      # CLI entry point (review, skills, config)
│   ├── types.ts                    # TypeScript interfaces
│   │
│   ├── adapters/
│   │   ├── vcs/
│   │   │   ├── base.ts             # VCSAdapter interface
│   │   │   ├── github.ts           # GitHub implementation (Octokit)
│   │   │   └── azure-devops.ts     # Azure DevOps (LCS diff, path normalisation)
│   │   └── ticket/                 # Phase 3 — Ticket integration (stubs)
│   │
│   ├── llm/
│   │   ├── base.ts                 # BaseLLMBackend abstract class
│   │   ├── unified.ts              # UnifiedLLMBackend (Vercel AI SDK)
│   │   ├── prompt.ts               # Shared prompt builder
│   │   └── parser.ts               # Shared response parser
│   │
│   ├── review/
│   │   ├── engine.ts               # ReviewEngine — orchestrates review process
│   │   ├── comment-manager.ts      # Platform-agnostic comment posting
│   │   ├── deduplication.ts        # Comment filtering and dedup logic
│   │   ├── checkpoint.ts           # Incremental review state tracking
│   │   ├── thread.ts               # Comment thread types and utilities
│   │   └── reply.ts                # LLM-powered reply generation
│   │
│   ├── skills/
│   │   └── loader.ts               # SkillLoader — glob pattern matching
│   │
│   └── webhook/
│       └── handler.ts              # GitHub webhook handler for comment replies
│
├── skills/
│   ├── default/SKILL.md
│   ├── security/SKILL.md
│   ├── frontend/SKILL.md
│   └── backend/SKILL.md
│
├── docs/                           # Internal documentation (you are here)
├── __tests__/                      # Jest test suite
└── package.json
```

## v2 Target: Monorepo Structure

The current `src/` is **Layer 0** — the existing CLI reviewer that does not change. The v2 roadmap wraps new layers around it. See [roadmap/v2.md](../roadmap/v2.md) for the full build order.

```
packages/
├── core/src/
│   ├── parser/     # Tree-sitter wrappers (TypeScript → Python → Go)
│   ├── graph/      # InMemorySymbolGraph — adjacency list + BFS traversal
│   ├── embeddings/ # Symbol embeddings + vector search
│   ├── indexer/    # Full + incremental indexing (never re-index whole repo)
│   ├── retriever/  # Graph-augmented RAG — blast radius context assembler
│   ├── reviewer/   # ← current src/ lives here, unchanged
│   └── storage/    # StorageAdapter: SQLite (default) | Postgres+pgvector
├── api/            # Fastify API server, SSE indexing progress, webhooks
├── dashboard/      # Next.js frontend, GitHub + Azure AD OAuth
└── shared/         # ParsedSymbol, Edge, BlastRadius, ReviewContext types
```

**The only modification to the existing reviewer:** a `context` parameter added to the prompt, populated by the graph retriever before the LLM is called.

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript / Node.js ≥ 18 |
| CLI Framework | `commander` |
| GitHub API | `@octokit/rest` |
| Azure DevOps API | `node-fetch` (REST) |
| LLM unified backend | Vercel AI SDK (`@ai-sdk/openai-compatible`) |
| Diff Algorithm | Myers LCS (custom implementation) |
| Config | `js-yaml` |
