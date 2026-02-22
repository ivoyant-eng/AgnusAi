# Monorepo Layers

AgnusAI is built in layers. Each layer is independently runnable and tested before the next is built.

## Layer 0 — CLI Reviewer (exists)

**Package:** `packages/reviewer`

The original diff-aware CLI reviewer. Runs in any CI/CD pipeline with no infrastructure.

```bash
node packages/reviewer/dist/cli.js review --pr 42 --repo owner/repo
```

**Inputs:** GitHub/Azure PR number + VCS token
**Outputs:** Inline review comments posted to the PR
**Dependencies:** LLM backend (Ollama, OpenAI, Claude, Azure)

**Must never be broken.** All v2 work is additive.

## Layer 1 — Core Indexing Engine

**Package:** `packages/core`

Parses source files into a symbol graph and persists it to Postgres.

Sub-components:

| Component | Role |
|-----------|------|
| `ParserRegistry` | Routes files to the right Tree-sitter parser by extension |
| `TypeScriptParser` | Parses `.ts/.tsx/.js/.jsx` |
| `PythonParser` | Parses `.py` |
| `JavaParser` | Parses `.java` |
| `GoParser` | Parses `.go` |
| `CSharpParser` | Parses `.cs` |
| `InMemorySymbolGraph` | Adjacency list — BFS for callers/callees |
| `PostgresStorageAdapter` | Persists symbols, edges, snapshots, embeddings |
| `Indexer` | Orchestrates full + incremental indexing + embedding |
| `EmbeddingAdapter` | Interface for Ollama/OpenAI/Google/HTTP adapters |
| `Retriever` | Assembles `GraphReviewContext` from diff + graph + embeddings |

## Layer 2 — Fastify API Server

**Package:** `packages/api`

Long-running server that receives webhooks and orchestrates the full review pipeline.

- `POST /webhooks/github` — push → incremental index; PR → review
- `POST /webhooks/azure` — same for Azure DevOps
- `POST /api/repos` — register repo, trigger full index
- `GET /api/repos/:id/index/status` — SSE stream of indexing progress
- `GET /api/repos/:id/graph/blast-radius/:symbolId` — blast radius JSON
- `DELETE /api/repos/:id` — deregister repo

## Layer 3 — CI Adapters _(planned)_

GitHub Actions + Azure Pipelines YAML that trigger a review via the API rather than running the CLI directly. Useful when the hosted service is already running and you want CI to also request a review on demand.

## Layer 4 — Dashboard _(planned)_

**Package:** `packages/dashboard`

Vite React SPA. Onboarding flow, repo registration, SSE indexing progress visualization, review history, settings (review depth, skills).

## Layer 5 — Docker Compose Packaging _(exists)_

`docker-compose.yml` bundles API + Postgres + Ollama for self-hosted deployments. [See Docker guide →](../guide/docker)

## Dependency Graph

```
shared  ←  core  ←  reviewer
                 ←  api
docs (standalone, no runtime dependencies)
```

`shared` has no runtime dependencies.
`core` depends on `shared`.
`reviewer` depends on `shared` (for `GraphReviewContext` type).
`api` depends on `core` and `reviewer`.
