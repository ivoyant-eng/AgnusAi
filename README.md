# AgnusAI

Open-source, self-hostable AI code reviewer with graph-aware blast radius analysis.

AgnusAI indexes your codebase with Tree-sitter, builds a symbol dependency graph stored in Postgres, and uses it to give every PR review real context — not just the diff.

---

## Modes

| Mode | What it is | When to use |
|------|-----------|-------------|
| **CLI (Layer 0)** | Single-shot reviewer triggered from CI/CD or terminal | Fastest way to start. No server, no Postgres. |
| **Hosted Service (v2)** | Fastify server + webhook listener + graph indexer + dashboard | Full graph-aware reviews. Runs outside CI. |

---

## Quickstart — CLI Mode

No server required. Just Node.js and an LLM.

```bash
git clone https://github.com/ivoyant-eng/AgnusAi.git
cd AgnusAi
pnpm install
pnpm --filter @agnus-ai/reviewer build

# Dry run — print review without posting comments
GITHUB_TOKEN=$(gh auth token) \
  node packages/reviewer/dist/cli.js review --pr 123 --repo owner/repo --dry-run

# With Ollama (local, free)
ollama pull qwen2.5-coder
GITHUB_TOKEN=$(gh auth token) \
  node packages/reviewer/dist/cli.js review --pr 123 --repo owner/repo

# With Claude
GITHUB_TOKEN=$(gh auth token) ANTHROPIC_API_KEY=sk-ant-... \
  node packages/reviewer/dist/cli.js review --pr 123 --repo owner/repo --provider claude

# Azure DevOps
AZURE_DEVOPS_TOKEN=... \
  node packages/reviewer/dist/cli.js review --pr 456 --repo org/repo --vcs azure
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--pr <number>` | PR number to review |
| `--repo <owner/repo>` | Repository slug |
| `--vcs github\|azure` | VCS platform (default: github) |
| `--provider ollama\|claude\|openai\|azure` | LLM provider |
| `--model <name>` | Override model name |
| `--dry-run` | Print review, don't post comments |
| `--incremental` | Only review new commits since last checkpoint |
| `--output json` | Machine-readable output |
| `--skill <name>` | Force a specific skill |

---

## Quickstart — Hosted Service (v2)

Full graph-aware reviews via webhooks. Requires Docker.

### 1. Clone and configure

```bash
git clone https://github.com/ivoyant-eng/AgnusAi.git
cd AgnusAi
cp .env.example .env
```

Edit `.env`:

```env
# Auth — admin bootstrapped on first run
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme
JWT_SECRET=change-me-in-production

# Webhooks
WEBHOOK_SECRET=your-secret-here

# LLM — defaults to local Ollama
LLM_PROVIDER=ollama
LLM_MODEL=qwen2.5-coder

# Embeddings — for deep review mode (optional)
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=qwen3-embedding:0.6b

# Review depth: fast | standard | deep
REVIEW_DEPTH=standard
```

### 2. Start with Docker Compose

```bash
docker compose up --build
```

This starts:
- **AgnusAI API** on `http://localhost:3000`
- **Postgres + pgvector** on port 5432

> Ollama runs on your host, not inside Docker. The container connects to `host.docker.internal:11434` by default.

### 3. Pull LLM models (first time)

AgnusAI connects to Ollama running **on your host** (not inside Docker). Pull models directly:

```bash
ollama pull qwen2.5-coder
ollama pull qwen3-embedding:0.6b   # only if EMBEDDING_PROVIDER=ollama
```

> If Ollama is not installed: [ollama.ai/download](https://ollama.ai/download). The container reaches it at `host.docker.internal:11434`.

### 4. Log in to the dashboard

Open `http://localhost:3000/app/` and sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env`.

### 5. Register a repository

**Via the dashboard:** click **Connect Repo**, enter the URL, token, and branches, then submit.

**Via the API:**

```bash
# Save session cookie
curl -c /tmp/agnus.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"changeme"}'

# Register repo
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

Response:
```json
{"repoId": "aHR0cHM6...", "branches": ["main", "develop"], "message": "Indexing started for 2 branch(es)..."}
```

### 6. Watch indexing progress

```bash
curl -N -b /tmp/agnus.txt \
  "http://localhost:3000/api/repos/<repoId>/index/status?branch=main"
```

```
data: {"step":"parsing","file":"src/auth.ts","progress":1,"total":150}
data: {"step":"embedding","symbolCount":235,"progress":32,"total":235}
data: {"step":"done","symbolCount":235,"edgeCount":1194,"durationMs":4200}
```

### 7. Configure GitHub webhooks

In your GitHub repo: **Settings → Webhooks → Add webhook**

- **Payload URL:** `https://your-server:3000/api/webhooks/github`
- **Content type:** `application/json`
- **Secret:** value of `WEBHOOK_SECRET`
- **Events:** `Push`, `Pull requests`

From now on, every PR open/sync triggers a graph-aware review automatically.

### 8. Dashboard, docs, and team management

- **Dashboard:** `http://localhost:3000/app/` — repos, indexing progress, review history, settings
- **Docs:** `http://localhost:3000/docs/`
- **Invite team members:** Settings → Generate Invite Link (admin only)

---

## Building Locally (without Docker)

Requires: Node.js 18+, pnpm 8+, a running Postgres instance.

```bash
pnpm install

# Build all packages in dependency order
pnpm build

# Or build individually
pnpm --filter @agnus-ai/shared build
pnpm --filter @agnus-ai/core build
pnpm --filter @agnus-ai/reviewer build
pnpm --filter @agnus-ai/api build
pnpm --filter @agnus-ai/docs build
pnpm --filter @agnus-ai/dashboard build
```

Start the API server:

```bash
# Export env vars from .env then:
node packages/api/dist/index.js
```

Or with a dotenv runner:

```bash
# Using dotenvx, direnv, or similar
dotenvx run -- node packages/api/dist/index.js
```

### Live development

```bash
# Rebuild reviewer on file change
pnpm --filter @agnus-ai/reviewer build -- --watch

# Preview VitePress docs
pnpm --filter @agnus-ai/docs dev
# → http://localhost:5173/docs/
```

---

## Monorepo Structure

```
packages/
├── reviewer/     CLI reviewer (Layer 0) — works standalone
├── shared/       TypeScript types: ParsedSymbol, Edge, BlastRadius, GraphReviewContext
├── core/         Tree-sitter parser, InMemorySymbolGraph, Postgres adapter, Indexer, Retriever
├── api/          Fastify server — webhooks, SSE, REST API, landing page, docs serving
├── dashboard/    Vite React SPA — served at /app/
└── docs/         VitePress documentation — served at /docs/
```

---

## Review Modes

| Mode | Graph hops | Embeddings | Best for |
|------|-----------|------------|----------|
| `fast` | 1 hop | No | Quick feedback, large PRs |
| `standard` | 2 hops | No | Default — good balance |
| `deep` | 2 hops | Yes (pgvector) | High-stakes changes |

Set via `REVIEW_DEPTH` in `.env`.

---

## LLM Providers

| Provider | `LLM_PROVIDER` | Notes |
|----------|---------------|-------|
| Ollama (local) | `ollama` | Free, private, no API key |
| OpenAI | `openai` | Requires `OPENAI_API_KEY` |
| Claude (Anthropic) | `claude` | Requires `ANTHROPIC_API_KEY` |
| Azure OpenAI | `azure` | Requires `AZURE_OPENAI_KEY` + endpoint |

---

## Embedding Providers

Used only in `REVIEW_DEPTH=deep` mode:

| Provider | `EMBEDDING_PROVIDER` | Model |
|----------|---------------------|-------|
| Ollama | `ollama` | `nomic-embed-text` (768-dim) |
| OpenAI | `openai` | `text-embedding-3-small` (1536-dim) |
| Google | `google` | `text-embedding-004` (768-dim) |
| Generic HTTP | `http` | Any OpenAI-compatible endpoint |

---

## Supported Languages

| Language | Extensions | Parser |
|----------|-----------|--------|
| TypeScript / JavaScript | `.ts .tsx .js .jsx` | Tree-sitter |
| Python | `.py` | Tree-sitter |
| Java | `.java` | Tree-sitter |
| C# | `.cs` | Tree-sitter |
| Go | `.go` | Tree-sitter (ABI mismatch — skipped at runtime, see [Known Issues](/docs/reference/known-issues)) |

---

## CI/CD Integration

If you are running the **hosted service** (v2), your CI pipeline needs to do nothing — webhooks handle reviews automatically the moment a PR is opened or updated. Set up the webhook once (step 7 of the quickstart) and you're done.

Use the pipeline snippets below only if you want to **explicitly trigger a review from a pipeline step**, or if you are using the **CLI mode** without a server.

---

### Option A — Trigger your hosted AgnusAI server (recommended)

Your server already has the repo indexed. The pipeline just sends the PR number — no cloning, no LLM keys, no build step.

Add these as repository/pipeline secrets:

| Secret | Value |
|--------|-------|
| `AGNUS_URL` | Your server URL, e.g. `https://agnus.company.com` |
| `AGNUS_API_KEY` | The `API_KEY` value from your server's `.env` |
| `AGNUS_REPO_ID` | The repo ID from the dashboard URL (`/app/ready/<repoId>`) |

**GitHub Actions:**

```yaml
name: AI PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger AgnusAI Review
        run: |
          curl -f -X POST "${{ secrets.AGNUS_URL }}/api/repos/${{ secrets.AGNUS_REPO_ID }}/review" \
            -H "Authorization: Bearer ${{ secrets.AGNUS_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "prNumber": ${{ github.event.pull_request.number }},
              "baseBranch": "${{ github.event.pull_request.base.ref }}"
            }'
```

**Azure Pipelines:**

```yaml
trigger: none
pr:
  branches:
    include: ['*']

pool:
  vmImage: 'ubuntu-latest'

steps:
  - script: |
      curl -f -X POST "$(AGNUS_URL)/api/repos/$(AGNUS_REPO_ID)/review" \
        -H "Authorization: Bearer $(AGNUS_API_KEY)" \
        -H "Content-Type: application/json" \
        -d "{\"prNumber\": $(System.PullRequest.PullRequestId), \"baseBranch\": \"$(System.PullRequest.TargetBranch)\"}"
    displayName: Trigger AgnusAI Review
    env:
      AGNUS_URL: $(AGNUS_URL)
      AGNUS_REPO_ID: $(AGNUS_REPO_ID)
      AGNUS_API_KEY: $(AGNUS_API_KEY)
```

> Set `API_KEY` in your server's `.env` to enable this. The `AGNUS_REPO_ID` is shown in the dashboard URL when you view a repo's setup page.

---

### Option B — Standalone CLI (no server)

Use this only if you are **not** running the hosted service. Install the published npm package — no cloning, no building.

**GitHub Actions:**

```yaml
name: AI PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run Review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx @agnus-ai/reviewer review \
            --pr ${{ github.event.pull_request.number }} \
            --repo ${{ github.repository }} \
            --provider claude \
            --incremental
```

**Azure Pipelines:**

Set pipeline variables: `AZURE_DEVOPS_ORG` (e.g. `ivoyant`), `AZURE_DEVOPS_PROJECT` (e.g. `PlatformNX`), `ANTHROPIC_API_KEY` (secret).

```yaml
trigger: none
pr:
  branches:
    include: ['*']

pool:
  vmImage: 'ubuntu-latest'

steps:
  - script: |
      npx @agnus-ai/reviewer review \
        --pr $(System.PullRequest.PullRequestId) \
        --repo $(AZURE_DEVOPS_PROJECT)/$(Build.Repository.Name) \
        --vcs azure \
        --provider claude
    displayName: Run AI Review
    env:
      AZURE_DEVOPS_ORG: $(AZURE_DEVOPS_ORG)
      AZURE_DEVOPS_PROJECT: $(AZURE_DEVOPS_PROJECT)
      AZURE_DEVOPS_TOKEN: $(System.AccessToken)
      ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY)
```

> `System.AccessToken` needs **Contribute to pull requests** permission: Project Settings → Repositories → Security.

---

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | — | Landing page |
| `GET` | `/api/health` | — | Health check |
| `POST` | `/api/auth/login` | — | Email + password → session cookie |
| `POST` | `/api/auth/logout` | — | Clear session cookie |
| `GET` | `/api/auth/me` | ✓ | Current user identity |
| `POST` | `/api/auth/invite` | admin | Generate one-time invite link |
| `POST` | `/api/auth/register` | — | Register via invite token |
| `GET` | `/api/auth/api-key` | admin | Get masked preview of current API key |
| `POST` | `/api/auth/api-key` | admin | Generate (or regenerate) API key |
| `GET` | `/api/repos` | ✓ | List registered repos |
| `POST` | `/api/repos` | ✓ | Register repo + trigger full index |
| `GET` | `/api/repos/:id/index/status` | — | SSE indexing progress stream |
| `GET` | `/api/repos/:id/graph/blast-radius/:symbolId` | — | Blast radius for a symbol |
| `DELETE` | `/api/repos/:id` | ✓ | Deregister repo |
| `GET` | `/api/reviews` | ✓ | Last 50 reviews |
| `GET` | `/api/settings` | ✓ | Review depth preference |
| `POST` | `/api/settings` | ✓ | Update review depth preference |
| `POST` | `/api/webhooks/github` | HMAC | GitHub webhook receiver |
| `POST` | `/api/webhooks/azure` | HMAC | Azure DevOps webhook receiver |
| `GET` | `/app/*` | — | Dashboard (Vite React SPA) |
| `GET` | `/docs/*` | — | Documentation (VitePress) |

---

## Skills

Skills define review behaviour — they are markdown files with YAML front matter injected into the LLM prompt, matched by file glob pattern.

Place them in `~/.pr-review/skills/<name>/SKILL.md` or `packages/reviewer/skills/`.

```markdown
---
name: Security Review
trigger:
  - "**/api/**"
  - "**/*.ts"
priority: high
---

## Security Rules
- Flag all raw SQL string concatenation
- Require HMAC verification on webhook endpoints
```

---

## Documentation

Full docs are served at `/docs/` when the API server is running.

To build and preview docs locally:

```bash
pnpm --filter @agnus-ai/docs dev
# → http://localhost:5173/docs/
```

---

### P3: Multi-language LSP + Impact Analysis

| Language | LSP Server |
|----------|------------|
| TypeScript | `ts.createProgram()` |
| Python | Pyright / Pylance |
| Go | gopls |
| Rust | rust-analyzer |
| Java | jdtls |

**Impact Analysis:**
- Find all dependents of changed functions/classes
- Detect breaking API changes
- Suggest related files that may need updates
- Generate call graphs for affected code paths

---

## Architecture Overview (v2 Target)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GitHub Webhook                              │
│                   (PR events, comment replies)                      │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        PR Event Handler                             │
│              • Incremental Diff Analyzer                            │
│              • Comment Manager (post/reply/resolve)                 │
└─────────────────────────────────────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   LSP Manager    │  │  Context Builder  │  │    Vector DB     │
│  (P2/P3)         │  │                   │  │    (Qdrant)      │
│                  │  │ • Diff context    │  │                  │
│ • TypeScript     │  │ • Type info       │  │ • Embeddings     │
│ • Python (P3)    │  │ • Similar code    │  │ • Metadata       │
│ • Go (P3)        │  │ • Thread history  │  │ • Similarity     │
│ • Rust (P3)      │  │                   │  │   queries        │
└──────────────────┘  └──────────────────┘  └──────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        LLM Backend (Vercel AI SDK)                  │
│              Ollama • Claude • OpenAI • Azure • Custom              │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Comment Manager                              │
│              • Post inline comments                                 │
│              • Reply to threads                                     │
│              • Resolve stale comments                               │
│              • Update checkpoint                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

**Want to contribute?** Check [CONTRIBUTING.md](./CONTRIBUTING.md) or pick up an issue from the roadmap!

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — [Ashish Maurya](https://github.com/theashishmaurya)
