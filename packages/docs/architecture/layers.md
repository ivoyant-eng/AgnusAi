# Monorepo Layers

AgnusAI is built in layers. Each layer is independently runnable and tested before the next is built.

## Layer 0 — CLI Reviewer ✅

**Package:** `packages/reviewer`

The original diff-aware CLI reviewer. Runs in any CI/CD pipeline with no infrastructure.

```bash
node packages/reviewer/dist/cli.js review --pr 42 --repo owner/repo
```

**Inputs:** GitHub/Azure PR number + VCS token
**Outputs:** Inline review comments posted to the PR
**Dependencies:** LLM backend (Ollama, OpenAI, Claude, Azure)

**Must never be broken.** All v2 work is additive.

## Layer 1 — Core Indexing Engine ✅

**Package:** `packages/core`

Parses source files into a symbol graph and persists it to Postgres.

| Component | Role |
|-----------|------|
| `ParserRegistry` | Routes files to the right Tree-sitter parser by extension |
| `TypeScriptParser` | Parses `.ts/.tsx/.js/.jsx` |
| `PythonParser` | Parses `.py` |
| `JavaParser` | Parses `.java` |
| `GoParser` | Parses `.go` (ABI mismatch at runtime — skipped gracefully) |
| `CSharpParser` | Parses `.cs` |
| `InMemorySymbolGraph` | Adjacency list — BFS for callers/callees |
| `PostgresStorageAdapter` | Persists symbols, edges, snapshots, embeddings |
| `Indexer` | Orchestrates full + incremental indexing + embedding |
| `EmbeddingAdapter` | Interface for Ollama/OpenAI/Google/HTTP adapters |
| `Retriever` | Assembles `GraphReviewContext` from diff + graph + embeddings |

## Layer 2 — Fastify API Server ✅

**Package:** `packages/api`

Long-running server that receives webhooks, orchestrates reviews, serves the dashboard and docs, and exposes the REST API.

**Auth endpoints:**
- `POST /api/auth/login` — email + password → httpOnly JWT cookie
- `POST /api/auth/logout` — clear cookie
- `GET /api/auth/me` — current user identity
- `POST /api/auth/invite` — admin generates one-time invite link
- `POST /api/auth/register` — register via invite token

**Repo endpoints (auth required):**
- `GET /api/repos` — list registered repos
- `POST /api/repos` — register repo + trigger full index (multi-branch)
- `GET /api/repos/:id/index/status` — SSE indexing progress stream
- `GET /api/repos/:id/graph/blast-radius/:symbolId` — blast radius JSON
- `DELETE /api/repos/:id` — deregister repo

**Review endpoints (auth required):**
- `GET /api/reviews` — last 50 reviews with verdict + comment count

**Settings endpoints (auth required):**
- `GET /api/settings` — user's review depth preference
- `POST /api/settings` — update review depth preference

**Webhook endpoints (no auth — verified by HMAC):**
- `POST /api/webhooks/github` — push → incremental index; PR open/sync → review → save to DB
- `POST /api/webhooks/azure` — same for Azure DevOps

## Layer 3 — CI Adapters _(planned)_

GitHub Actions + Azure Pipelines YAML that trigger a review via the API rather than running the CLI directly. Useful when the hosted service is already running and you want CI to also request a review on demand.

## Layer 4 — Dashboard ✅

**Package:** `packages/dashboard`

Vite React SPA served at `/app/`. Built into the Docker image and served directly by Fastify — no separate web server needed.

**Features:**
- Login / register (invite-only for non-admin users)
- Connect Repo form (URL, token, branches — comma-separated)
- SSE indexing progress visualization
- Dashboard: repo list + recent reviews table
- Settings: review depth selector (persisted per user) + admin invite link generator
- Sign out

**Auth:** httpOnly JWT cookie (`agnus_session`). All `/app/*` routes protected by `AuthGuard` — unauthenticated users are redirected to `/login`.

## Layer 5 — Docker Compose Packaging ✅

`docker-compose.yml` builds the full stack in a single image:
- API server (Node.js)
- Dashboard SPA (built by Vite, served by Fastify at `/app/`)
- Docs (built by VitePress, served by Fastify at `/docs/`)

External services: Postgres + pgvector (bundled), Ollama (host machine or separate service).

[See Docker guide →](../guide/docker)

## Dependency Graph

```
shared  ←  core  ←  reviewer
                 ←  api
dashboard  (served by api at /app/)
docs       (served by api at /docs/)
```

`shared` has no runtime dependencies.
`core` depends on `shared`.
`reviewer` depends on `shared` (for `GraphReviewContext` type).
`api` depends on `core` and `reviewer`.
