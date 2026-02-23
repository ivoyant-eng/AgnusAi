# Hosted Service Setup

The hosted service is a Fastify server that receives webhooks from GitHub or Azure DevOps, indexes your repo incrementally, and posts graph-aware reviews automatically.

## How It Works

```
GitHub Push  ──→  POST /api/webhooks/github  ──→  incrementalUpdate(changedFiles)
GitHub PR    ──→  POST /api/webhooks/github  ──→  getReviewContext(diff) → review → post comments
```

1. You log in to the dashboard and connect a repository — a full index runs in the background
2. On every subsequent push, only changed files are re-parsed and re-embedded
3. On every PR open or synchronize event, the graph context is assembled and injected into the LLM prompt

## Prerequisites

- Postgres 16+ with the `pgvector` extension
- An LLM (local Ollama recommended, or any cloud provider)
- Optionally an embedding model for `deep` review mode
- A public URL reachable by GitHub/Azure for webhooks (use [smee.io](https://smee.io) or [ngrok](https://ngrok.com) in dev)

## Start the API Server

```bash
pnpm install
pnpm --filter @agnus-ai/shared build
pnpm --filter @agnus-ai/core build
pnpm --filter @agnus-ai/reviewer build
pnpm --filter @agnus-ai/api build

cp .env.example .env   # then fill in credentials
export $(grep -v '^#' .env | xargs)
node packages/api/dist/index.js
```

Server starts on port `3000` by default. Override with `PORT=8080`.

## First Login

On startup, if the `users` table is empty and `ADMIN_EMAIL` + `ADMIN_PASSWORD` are set in `.env`, an admin account is bootstrapped automatically.

Open the dashboard at `http://localhost:3000/app/` and sign in with those credentials.

## Register a Repo

**Via the dashboard:** click **Connect Repo**, enter the URL, access token, and comma-separated branches, then submit.

**Via the API** (requires an active session cookie):

```bash
# 1. Log in and save the session cookie
curl -c /tmp/agnus.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"changeme"}'

# 2. Register the repo (branches defaults to ["main"] if omitted)
curl -b /tmp/agnus.txt -X POST http://localhost:3000/api/repos \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "platform": "github",
    "token": "ghp_...",
    "repoPath": "/path/to/local/clone",
    "branches": ["main", "develop"]
  }'
```

Returns `{ "repoId": "...", "branches": [...], "message": "Indexing started..." }`.

Track progress via SSE:

```bash
curl -N -b /tmp/agnus.txt \
  "http://localhost:3000/api/repos/{repoId}/index/status?branch=main"
```

## Configure GitHub Webhooks

1. Go to your repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL:** `https://your-server.com/api/webhooks/github`
3. **Content type:** `application/json`
4. **Secret:** value of `WEBHOOK_SECRET` from your `.env`
5. **Events:** `Push` + `Pull requests`

## Configure Azure DevOps Webhooks

1. Go to your project → **Project Settings** → **Service hooks**
2. Add subscription for `git.push` and `git.pullrequest.created` / `git.pullrequest.updated`
3. **URL:** `https://your-server.com/api/webhooks/azure`

## Inviting Team Members

Admin users can generate one-time invite links from **Settings → Team** in the dashboard, or via the API:

```bash
curl -b /tmp/agnus.txt -X POST http://localhost:3000/api/auth/invite \
  -H "Content-Type: application/json" \
  -d '{"email":"colleague@example.com"}'
# → {"token":"...","url":"http://your-server/login?invite=..."}
```

Share the URL. The recipient opens it, chooses a password, and gets `member` access.

## Environment Variables

See [Environment Variables →](./env-vars) for the full reference.

## Production Deployment

For production, use [Docker Compose →](./docker) which bundles the API, Postgres, dashboard, and docs together in a single `docker compose up --build`.
