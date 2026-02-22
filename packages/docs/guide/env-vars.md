# Environment Variables

All configuration is through environment variables. Copy `.env.example` to `.env` to get started.

## Required

| Variable | Description |
|----------|-------------|
| `WEBHOOK_SECRET` | Secret used to verify GitHub webhook signatures (`X-Hub-Signature-256`). Any strong random string. |
| `SESSION_SECRET` | Secret for session encryption. Any strong random string. |
| `GITHUB_TOKEN` | GitHub personal access token with `repo` scope for reading PRs and posting comments. |

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
| `EMBEDDING_PROVIDER` | — | `ollama` \| `openai` \| `google` \| `http`. If unset, embeddings are disabled (standard mode only). |
| `EMBEDDING_MODEL` | `qwen3-embedding:0.6b` | Embedding model name. |
| `EMBEDDING_BASE_URL` | `http://localhost:11434` | Base URL for Ollama or HTTP provider. |
| `EMBEDDING_API_KEY` | — | Required for `openai`, `google`, `http` providers. |

## Review

| Variable | Default | Description |
|----------|---------|-------------|
| `REVIEW_DEPTH` | `standard` | `fast` — 1-hop graph, no embeddings. `standard` — 2-hop graph, no embeddings. `deep` — 2-hop + semantic neighbors via embedding search. |

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the API server listens on. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DASHBOARD_DIST` | `packages/dashboard/dist` | Path to built dashboard static files. |

## Azure DevOps (optional)

| Variable | Description |
|----------|-------------|
| `AZURE_DEVOPS_TOKEN` | PAT with Code Read + Pull Request Contribute permissions. |

## Full Example

```bash
# Required
WEBHOOK_SECRET=my-secret-key
SESSION_SECRET=my-session-secret

# Postgres
DATABASE_URL=postgres://agnus:agnus@localhost:5432/agnus

# LLM — Ollama (local, default)
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5-coder

# Embeddings — Ollama (local, default)
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=qwen3-embedding:0.6b

# Review depth
REVIEW_DEPTH=standard

# VCS
GITHUB_TOKEN=ghp_...
```
