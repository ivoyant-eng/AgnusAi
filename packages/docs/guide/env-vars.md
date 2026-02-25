# Environment Variables

All configuration is through environment variables. The easiest way to get a correct `.env` is to run `bash install.sh` — it copies `.env.example` and auto-generates `WEBHOOK_SECRET`, `SESSION_SECRET`, and `JWT_SECRET` with `openssl rand -hex 32`. To set up manually, copy `.env.example` to `.env` and generate those secrets yourself.

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

Set `LLM_PROVIDER` to select your provider, then fill in the provider-specific variables below.

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `ollama` | `ollama` \| `openai` \| `azure` \| `claude` \| `custom` |
| `LLM_MODEL` | `qwen3.5:397b-cloud` | Model or deployment name. Provider-specific. |

### Ollama

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Base URL for your Ollama instance. Use `http://host.docker.internal:11434/v1` inside Docker. |

### OpenAI

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (`sk-proj-...`). |

### Azure OpenAI

| Variable | Default | Description |
|----------|---------|-------------|
| `AZURE_OPENAI_ENDPOINT` | — | Full deployment URL: `https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>` |
| `AZURE_OPENAI_API_KEY` | — | Azure subscription key. |
| `AZURE_API_VERSION` | `2025-01-01-preview` | Azure REST API version. Also used by the Azure embedding provider. |

### Anthropic / Claude

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (`sk-ant-...`). |

### Custom (any OpenAI-compatible endpoint)

| Variable | Description |
|----------|-------------|
| `CUSTOM_LLM_URL` | Base URL of the endpoint (e.g. `https://api.together.xyz/v1`). |
| `CUSTOM_LLM_API_KEY` | API key, if required. |

## Embeddings

Set `EMBEDDING_PROVIDER` to enable deep review mode (2-hop + semantic neighbor search). Leave unset for standard/fast mode.

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | — | `ollama` \| `openai` \| `azure` \| `google` \| `http`. Unset = embeddings disabled. |
| `EMBEDDING_MODEL` | provider default | Embedding model name. |
| `EMBEDDING_BASE_URL` | — | Base URL for `ollama`, `azure`, or `http` providers. |
| `EMBEDDING_API_KEY` | — | API key for `openai`, `azure`, `google`, or `http` providers. |

Azure embeddings reuse `AZURE_API_VERSION` from the LLM section.

## Review

| Variable | Default | Description |
|----------|---------|-------------|
| `REVIEW_DEPTH` | `standard` | `fast` — 1-hop graph, no embeddings. `standard` — 2-hop graph, no embeddings. `deep` — 2-hop + semantic neighbors via embedding search. |
| `PRECISION_THRESHOLD` | `0.7` | Minimum LLM confidence score (0.0–1.0) required to post a comment. Comments with `[Confidence: X.X]` below this threshold are silently dropped. |
| `MAX_DIFF_SIZE` | `150000` | Maximum characters of diff sent to the LLM. Increase for large PRs. |

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
# Auth
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme
JWT_SECRET=change-me-in-production

# Webhooks
WEBHOOK_SECRET=my-secret-key
SESSION_SECRET=my-session-secret
BASE_URL=http://localhost:3000
FEEDBACK_SECRET=my-feedback-secret

# Postgres
DATABASE_URL=postgres://agnus:agnus@localhost:5432/agnus

# LLM — choose one provider block

# Option A: Ollama (local, default)
LLM_PROVIDER=ollama
LLM_MODEL=qwen3.5:397b-cloud
OLLAMA_BASE_URL=http://localhost:11434/v1

# Option B: OpenAI
# LLM_PROVIDER=openai
# LLM_MODEL=gpt-4o-mini
# OPENAI_API_KEY=sk-proj-...

# Option C: Azure OpenAI
# LLM_PROVIDER=azure
# LLM_MODEL=gpt-4o
# AZURE_OPENAI_ENDPOINT=https://my-resource.cognitiveservices.azure.com/openai/deployments/gpt-4o
# AZURE_OPENAI_API_KEY=...
# AZURE_API_VERSION=2025-01-01-preview

# Option D: Anthropic / Claude
# LLM_PROVIDER=claude
# LLM_MODEL=claude-sonnet-4-6
# ANTHROPIC_API_KEY=sk-ant-...

# Embeddings — needed only for deep mode (choose one)
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
