# Docker Compose

The fastest way to self-host AgnusAI with everything included: API server, Postgres + pgvector, and Ollama.

## Quick Start

```bash
cp .env.example .env
# Edit .env — at minimum set WEBHOOK_SECRET and SESSION_SECRET

docker compose up --build
```

That's it. Three services start:

| Service | Port | Description |
|---------|------|-------------|
| `agnus` | 3000 | Fastify API server |
| `postgres` | 5432 | Postgres 16 + pgvector |
| `ollama` | 11434 | Local LLM + embedding server |

## Pull Models

After the containers start, pull the LLM and embedding models:

```bash
# LLM
docker compose exec ollama ollama pull qwen2.5-coder

# Embedding model (639MB, 40K context, CPU-friendly)
docker compose exec ollama ollama pull qwen3-embedding:0.6b
```

## Register Your First Repo

```bash
curl -X POST http://localhost:3000/api/repos \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "platform": "github",
    "token": "ghp_...",
    "repoPath": "/workspace/repo"
  }'
```

> **Note:** `repoPath` should be a path accessible inside the `agnus` container. Mount it in `docker-compose.yml` under `volumes` if needed.

## Environment Variables

The compose file reads from `.env`. Key variables:

```bash
WEBHOOK_SECRET=change-me        # required — GitHub webhook signature key
SESSION_SECRET=change-me        # required — session encryption key
DATABASE_URL=postgres://...     # set automatically by compose
LLM_PROVIDER=ollama
LLM_BASE_URL=http://ollama:11434/v1
LLM_MODEL=qwen2.5-coder
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://ollama:11434
EMBEDDING_MODEL=qwen3-embedding:0.6b
REVIEW_DEPTH=standard           # fast | standard | deep
GITHUB_TOKEN=ghp_...
```

## Use Cloud LLM Instead of Ollama

To use OpenAI or Claude instead of the local Ollama container, set:

```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

You can remove the `ollama` service from `docker-compose.yml` if you don't need local embeddings either.

## Data Persistence

All data persists in named Docker volumes:

- `postgres-data` — symbol graph, edges, embeddings, graph snapshots
- `ollama-data` — downloaded model weights

To reset everything: `docker compose down -v`

## Health Check

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

## Updating

```bash
git pull
docker compose up --build
```

Schema migrations run automatically on startup (idempotent).
