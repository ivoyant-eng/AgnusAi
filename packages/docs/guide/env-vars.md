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
| `LLM_TEMPERATURE` | `0.2` | Sampling temperature for agent generation (0.0–1.0). `0.2` gives low variance while preserving non-obvious reasoning. Judge and self-reflection calls are always forced to `0` regardless of this value. |

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
| `PRECISION_THRESHOLD` | `0.7` | Minimum LLM self-assessed confidence score (0.0–1.0) a comment must carry to be posted. Comments reporting `[Confidence: X.X]` below this value are silently dropped. Raise to `0.75`–`0.8` to reduce low-confidence noise. |
| `MAX_DIFF_SIZE` | `150000` | Maximum characters of diff sent to the LLM. Increase for large PRs. |

## Multi-Agent Review

| Variable | Default | Description |
|----------|---------|-------------|
| `MULTI_AGENT_ENABLED` | `false` | Enable the parallel specialist agent pipeline. |
| `REVIEW_MODE` | `single` | `single` — original single-agent. `fast` — security + correctness only. `thorough` — all applicable agents. |
| `AGENT_CONCURRENCY` | `2` | Number of specialist agents that run in parallel. |
| `ENABLED_AGENTS` | _(all)_ | Comma-separated list to override which agents run, e.g. `security,correctness`. |
| `JUDGE_ENABLED` | `true` | Run a deduplication/consolidation judge pass after agents complete. |
| `JUDGE_MODE` | `llm` (when multi-agent on) | `llm` — LLM semantically deduplicates and selects the best findings (default when `MULTI_AGENT_ENABLED=true`). `deterministic` — fast rule-based dedup by location only, no extra LLM call. |
| `SELF_REFLECTION_ENABLED` | `false` | Enable a second LLM pass that re-scores every surviving comment 0–10 based on evidence quality and drops those below `SELF_REFLECTION_THRESHOLD`. Reduces noise at the cost of one extra LLM call. |
| `SELF_REFLECTION_THRESHOLD` | `5` | Minimum score (0–10) a comment must receive in the self-reflection pass to survive. `6` is recommended for stricter signal-to-noise. |
| `AGENT_TOOL_MAX_ROUNDS` | _(adaptive)_ | Max tool-call rounds per agent. Defaults: ≤3 files→3, 4–10 files→4, >10 files→5. Set to a fixed number to override. |
| `TOOL_DEBUG` | `false` | Log every agent tool call and round to stdout. Useful for verifying agents are using exploration tools. |

See [Multi-Agent Review](/reference/multi-agent) for full details.

## Rules

| Variable | Default | Description |
|----------|---------|-------------|
| `RULES_SYSTEM_ENABLED` | `true` | Enable rule enforcement during reviews. Set to `false` to disable globally. |

See [Rules System](/reference/rules) for full details.

## Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `true` | Enable rate limiting on all endpoints. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` header for IP detection (set `true` behind a reverse proxy like Traefik/nginx). |
| `RATE_LIMIT_GLOBAL_MAX` | `300` | Max requests per IP per global window. |
| `RATE_LIMIT_GLOBAL_WINDOW` | `1 minute` | Global rate limit window. |
| `RATE_LIMIT_AUTH_MAX` | `20` | Max login/signup attempts per IP per auth window. |
| `RATE_LIMIT_AUTH_WINDOW` | `1 minute` | Auth rate limit window. |
| `RATE_LIMIT_WEBHOOK_MAX` | `120` | Max webhook events per IP per webhook window. |
| `RATE_LIMIT_WEBHOOK_WINDOW` | `1 minute` | Webhook rate limit window. |

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the API server listens on. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DASHBOARD_DIST` | auto-resolved | Path to built dashboard static files. Set automatically in Docker. |
| `DOCS_DIST` | auto-resolved | Path to built VitePress docs. Set automatically in Docker. |

## @ryv Commands

| Variable | Default | Description |
|----------|---------|-------------|
| `COMMANDS_ENABLED` | `true` | Master toggle. Set `false` to disable all `@ryv` commands globally (webhooks still run reviews). |
| `RYV_BOT_NAME` | `ryv` | Comma-separated list of account names that trigger commands. Auto-detection appends the service account display name at runtime. Example: `ryv,AI Agents,agnus`. |
| `COMMAND_MAX_PER_HOUR` | `10` | Max `@ryv` commands per PR per hour (anti-abuse). |

See [@ryv Commands](/reference/commands) for full details.

## OpenCode Sidecar

Required for `@ryv fix` and `@ryv test` commands. OpenCode is an agentic code-editing service that runs as a Docker sidecar.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_URL` | `http://opencode:4096` | URL of the OpenCode sidecar. Leave unset if not using agentic commands. |
| `OPENCODE_SERVER_PASSWORD` | — | Password for the OpenCode HTTP server. Set the same value in OpenCode's config. |
| `OPENCODE_PROVIDER_ID` | `opencode` | LLM provider OpenCode uses for agentic tasks. Built-in free proxy: `opencode`. |
| `OPENCODE_MODEL_ID` | `big-pickle` | Model for agentic tasks. OpenCode built-ins: `big-pickle`, `gpt-5-nano`, `mimo-v2-flash-free`. |

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
PRECISION_THRESHOLD=0.75
MAX_DIFF_SIZE=150000

# Multi-agent review (optional — enables parallel specialist agents)
MULTI_AGENT_ENABLED=true
REVIEW_MODE=thorough
AGENT_CONCURRENCY=2
JUDGE_ENABLED=true
JUDGE_MODE=llm
SELF_REFLECTION_ENABLED=true
SELF_REFLECTION_THRESHOLD=6

# VCS
GITHUB_TOKEN=ghp_...
```
