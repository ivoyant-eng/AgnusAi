# Building AgnusAI — Blog Series

AgnusAI went from a single TypeScript script to a full hosted service with a symbol dependency graph, RAG feedback loop, and multi-language support in roughly 7 days (101 commits, Feb 17–24, 2026). This series documents that journey.

## Posts

| # | Title | Theme |
|---|-------|-------|
| [1](./01-why-we-built-agnus-ai.md) | Why We Built AgnusAI (And Why Existing Tools Weren't Enough) | Problem statement, competitive gap |
| [2](./02-day-1-3-unified-llm-backend.md) | Day 1–3: From a Script to a Unified LLM Backend | Architecture evolution, early decisions |
| [3](./03-graph-engine-tree-sitter.md) | The Graph Engine: Why We Chose Tree-sitter WASM Over a Language Server | Core technical decision |
| [4](./04-three-depths-of-review.md) | Three Depths of Review: Fast, Standard, and Deep Mode | Review depth design, pgvector |
| [5](./05-hosted-service-monorepo-fastify.md) | Building the Hosted Service: Monorepo, Fastify, and the Dashboard | Full-stack pivot |
| [6](./06-precision-filter-and-rag-feedback.md) | Signal vs. Noise: Building the Precision Filter and RAG Feedback Loop | Quality improvements |
| [7](./07-business-implications.md) | Business Implications: Open-Source Moat, ICP, and the Path to Enterprise | GTM, positioning, monetization |

## Key Themes

- **Graph-aware review** — the only self-hosted code reviewer that understands your codebase dependency graph
- **Self-hostable** — one `docker compose up`, no external API keys required
- **Any LLM** — Ollama, OpenAI, Claude, Azure OpenAI through a unified backend interface
- **Precision filter** — LLM self-assesses confidence; low-signal comments dropped before posting
- **RAG feedback loop** — developer feedback trains the reviewer over time
