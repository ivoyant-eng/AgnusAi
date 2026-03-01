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

## Organizations

AgnusAI is multi-tenant. Every deployment starts with a single **default** org. All repos, members, webhooks, and rules belong to an org.

| Concept | Description |
|---------|-------------|
| **Org slug** | URL-safe identifier, e.g. `default` or `acme-corp` |
| **Org admin** | Can manage webhooks, rules, team members, and settings |
| **Member** | Can view repos and reviews for repos in their org |

The admin bootstrapped from `ADMIN_EMAIL` / `ADMIN_PASSWORD` is automatically added as org admin of the `default` org.

## Configure GitHub Webhooks

Each org has a dedicated webhook path so secrets and routing are isolated.

1. Go to your repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL:** `https://your-server.com/api/webhooks/github/default`
   _(replace `default` with your org slug if using multiple orgs)_
3. **Content type:** `application/json`
4. **Secret:** the webhook secret from **Settings → Webhook Secrets** in the dashboard
5. **Events:** `Push` + `Pull requests`

### Managing Webhook Secrets

Webhook secrets are managed per org and per platform in **Settings → Webhook Secrets**. You can generate or rotate a secret without redeploying — just update the secret in GitHub/Azure after rotating.

Via API:

```bash
# Get current secrets
GET /api/orgs/default/webhooks

# Rotate secret for a platform
POST /api/orgs/default/webhooks/rotate
{ "platform": "github" }
# → { "secret": "new-plaintext-secret" }   (shown once)
```

## Configure Azure DevOps Webhooks

1. Go to your project → **Project Settings** → **Service hooks**
2. Add subscription for `git.push`, `git.pullrequest.created`, and `git.pullrequest.updated`
3. **URL:** `https://your-server.com/api/webhooks/azure/default`
4. In the **HTTP Headers** field, add: `X-Webhook-Secret: <your-webhook-secret>`

Get the secret from **Settings → Webhook Secrets → Azure**.

## Enable Multi-Agent Review

Add to your `.env` (or Docker Compose environment):

```env
MULTI_AGENT_ENABLED=true
REVIEW_MODE=thorough       # all applicable specialist agents
AGENT_CONCURRENCY=2        # run 2 agents in parallel
JUDGE_ENABLED=true
JUDGE_MODE=deterministic
```

See [Multi-Agent Review →](/reference/multi-agent) for agent roles, judge modes, and cost estimates.

## Set Up Rules

Rules let org admins define code standards that are enforced on every PR review.

1. Open the Dashboard → **Rules**
2. Click **New Rule** and describe your policy in plain language
3. Choose the scope (`org`, `repo`, or `path`)
4. Enable the rule — it takes effect on the next review

Rules system is enabled by default. To disable: `RULES_SYSTEM_ENABLED=false`.

See [Rules System →](/reference/rules).

## Inviting Team Members

Admin users can generate one-time invite links from **Settings → Team** in the dashboard, or via the API:

```bash
curl -b /tmp/agnus.txt -X POST http://localhost:3000/api/auth/invite \
  -H "Content-Type: application/json" \
  -d '{"email":"colleague@example.com"}'
# → {"token":"...","url":"http://your-server/login?invite=..."}
```

Share the URL. The recipient opens it, chooses a password, and gets `member` access.

## Feedback Learning Loop

Each review comment posted to GitHub/Azure contains 👍/👎 links at the bottom:

```
Was this helpful? 👍 Yes · 👎 No
```

When a developer clicks one:

1. The API validates an HMAC-signed token and records the signal in `review_feedback`
2. On the next PR review for the same repo, the diff is embedded and the top-5 accepted comments are retrieved via pgvector similarity search
3. Those examples are injected into the LLM prompt — teaching it the style and depth that your team finds valuable

To enable feedback links you need two env vars:

```env
BASE_URL=https://your-server.com   # public URL so links resolve from GitHub
FEEDBACK_SECRET=any-random-string  # signs the HMAC tokens (falls back to WEBHOOK_SECRET)
```

View per-repo acceptance rates on the **Dashboard → Learning Metrics** chart (requires at least one rating).

::: warning Feedback links require BASE_URL
If `BASE_URL` is unset, feedback links are silently omitted from review comments. Reviews still work — you just won't collect ratings.
:::

## Environment Variables

See [Environment Variables →](./env-vars) for the full reference.

## Production Deployment

For production, use [Docker Compose →](./docker) which bundles the API, Postgres, dashboard, and docs together in a single `docker compose up --build`.
