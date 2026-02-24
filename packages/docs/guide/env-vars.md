# Environment Variables

All configuration is through environment variables. Copy `.env.example` to `.env` to get started.

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_EMAIL` | `admin@example.com` | Email of the root admin user. Bootstrapped automatically on first start if the users table is empty. |
| `ADMIN_PASSWORD` | `changeme` | Password for the root admin. **Change this in production.** |
| `JWT_SECRET` | — | Secret used to sign session JWTs. Use a long random string in production. |
| `SESSION_SECRET` | — | Legacy session secret (fallback if `JWT_SECRET` is unset). |

## Webhooks

| Variable | Description |
|----------|-------------|
| `WEBHOOK_SECRET` | Secret used to verify GitHub webhook signatures (`X-Hub-Signature-256`). Any strong random string. |
| `BASE_URL` | Public URL of this server (e.g. `https://agnus.example.com`). Used to build 👍/👎 feedback links appended to review comments. If unset, feedback links are omitted. |
| `FEEDBACK_SECRET` | HMAC secret for signing feedback URLs. Falls back to `WEBHOOK_SECRET` if unset. |

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | Postgres connection string. e.g. `postgres://user:pass@localhost:5432/agnus` |

## LLM

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `ollama` | `ollama` \| `openai` \| `anthropic` \| `azure` |
| `LLM_MODEL` | `qwen2.5-coder` | Model name. Provider-specific. |
| `LLM_BASE_URL` | `http://ollama:11434/v1` | Base URL for the LLM API. Used for Ollama and Azure. |
| `LLM_API_KEY` | — | API key. Required for OpenAI, Anthropic, Azure. |

## Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | — | `ollama` \| `openai` \| `google` \| `http`. If unset, embeddings are disabled (standard/fast mode only). |
| `EMBEDDING_MODEL` | `qwen3-embedding:0.6b` | Embedding model name. |
| `EMBEDDING_BASE_URL` | `http://localhost:11434` | Base URL for Ollama or HTTP provider. |
| `EMBEDDING_API_KEY` | — | Required for `openai`, `google`, `http` providers. |

## Review

| Variable | Default | Description |
|----------|---------|-------------|
| `REVIEW_DEPTH` | `standard` | `fast` — 1-hop graph, no embeddings. `standard` — 2-hop graph, no embeddings. `deep` — 2-hop + semantic neighbors via embedding search. |
| `PRECISION_THRESHOLD` | `0.7` | Minimum LLM confidence score (0.0–1.0) required to post a comment. Comments with `[Confidence: X.X]` below this threshold are silently dropped. |
| `MAX_DIFF_SIZE` | `150000` | Maximum number of characters of diff to send to the LLM. Increase for large PRs with many files. |

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the API server listens on. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DASHBOARD_DIST` | auto-resolved | Path to built dashboard static files. Set automatically in Docker. |
| `DOCS_DIST` | auto-resolved | Path to built VitePress docs. Set automatically in Docker. |

## VCS Tokens

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token with `repo` scope for reading PRs and posting comments. |
| `AZURE_DEVOPS_TOKEN` | PAT with Code Read + Pull Request Contribute permissions. |

## Full Example

```env
# Auth — root admin bootstrapped on first run
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme
JWT_SECRET=change-me-in-production

# Webhooks
WEBHOOK_SECRET=my-secret-key
SESSION_SECRET=my-session-secret

# Feedback links (append 👍/👎 to review comments)
BASE_URL=http://localhost:3000
FEEDBACK_SECRET=my-feedback-secret

# Postgres
DATABASE_URL=postgres://agnus:agnus@localhost:5432/agnus

# LLM — Ollama (local, default)
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3.5:397b-cloud

# Embeddings — Ollama (local, optional — needed only for deep mode)
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=qwen3-embedding:0.6b

# Review depth
REVIEW_DEPTH=standard
PRECISION_THRESHOLD=0.7
MAX_DIFF_SIZE=150000

# VCS
GITHUB_TOKEN=ghp_...
```
