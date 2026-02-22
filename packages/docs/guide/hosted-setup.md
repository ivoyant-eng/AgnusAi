# Hosted Service Setup

The hosted service is a Fastify server that receives webhooks from GitHub or Azure DevOps, indexes your repo incrementally, and posts graph-aware reviews automatically.

## How It Works

```
GitHub Push  ──→  POST /webhooks/github  ──→  incrementalUpdate(changedFiles)
GitHub PR    ──→  POST /webhooks/github  ──→  getReviewContext(diff) → review → post comments
```

1. You register a repo via the REST API — a full index runs in the background
2. On every subsequent push, only changed files are re-parsed and re-embedded
3. On every PR open or synchronize event, the graph context is assembled and injected into the LLM prompt

## Prerequisites

- Postgres 16+ with the `pgvector` extension
- An embedding model (local Ollama recommended, or any cloud provider)
- A public URL reachable by GitHub/Azure for webhooks (use [smee.io](https://smee.io) or [ngrok](https://ngrok.com) in dev)

## Start the API Server

```bash
pnpm install
pnpm --filter @agnus-ai/reviewer build
pnpm --filter @agnus-ai/shared build
pnpm --filter @agnus-ai/core build
pnpm --filter @agnus-ai/api build

export $(grep -v '^#' .env | xargs)
node packages/api/dist/index.js
```

Server starts on port `3000` by default. Override with `PORT=8080`.

## Register a Repo

```bash
curl -X POST http://localhost:3000/api/repos \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "platform": "github",
    "token": "ghp_...",
    "repoPath": "/path/to/local/clone"
  }'
```

Returns `{ "repoId": "...", "message": "Indexing started..." }`.

Track progress via SSE:

```bash
curl -N http://localhost:3000/api/repos/{repoId}/index/status
```

You'll see events like:

```
data: {"step":"parsing","file":"src/auth.ts","progress":42,"total":150}
data: {"step":"embedding","symbolCount":235,"progress":64,"total":235}
data: {"step":"done","symbolCount":235,"edgeCount":1194,"durationMs":48200}
```

## Configure GitHub Webhooks

1. Go to your repo → **Settings** → **Webhooks** → **Add webhook**
2. Payload URL: `https://your-server.com/webhooks/github`
3. Content type: `application/json`
4. Secret: value of `WEBHOOK_SECRET` from your `.env`
5. Events: **Push** + **Pull requests**

## Configure Azure DevOps Webhooks

1. Go to your project → **Project Settings** → **Service hooks**
2. Add subscription for `git.push` and `git.pullrequest.created` / `git.pullrequest.updated`
3. URL: `https://your-server.com/webhooks/azure`

## Environment Variables

See [Environment Variables →](./env-vars) for the full reference.

## Production Deployment

For production, use [Docker Compose →](./docker) which bundles the API, Postgres, and Ollama together.
