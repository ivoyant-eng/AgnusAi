# @ryv Command System

Ryv responds to natural language commands written in PR comments. Mention `@ryv` followed by anything you want done — a small LLM classification step routes to the right handler automatically.

## Trigger Syntax

```
@ryv <anything in natural language>
```

**Examples:**
```
@ryv what does this function do?
@ryv fix the hardcoded credentials
@ryv generate tests for the changed files
@ryv re-review this PR
@ryv help
```

Legacy `/ask <question>` continues to work as a backward-compatible alias.

---

## Available Commands

| Command | What it does |
|---------|-------------|
| `ask` | Answer any question about the PR, diff, or codebase using graph context |
| `review` | Trigger a fresh full review of the PR |
| `fix` | Autonomously fix a specific issue — opens a companion PR |
| `test` | Generate unit tests for the changed code |
| `help` | List all available commands with examples |

**Coming soon:** `implement`, `docs`, `changelog`, `ticket_create`, `similar`

---

## Bot Name — Zero Configuration Required

Ryv automatically resolves the display name of the service account that owns your PAT or OAuth token by calling the platform API once per server restart:

- **Azure DevOps:** `GET /_apis/connectionData` → `authenticatedUser.providerDisplayName`
- **GitHub:** `GET https://api.github.com/user` → `login`

The resolved name is cached per token. So if your Azure DevOps service account is named "AI Agents", writing `@AI Agents fix the null check` triggers Ryv — no extra configuration needed.

### Additional / Custom Names

To add more trigger names (comma-separated):

```env
RYV_BOT_NAME=ryv,AI Agents,agnus
```

Any of the configured names OR the auto-resolved account name triggers the bot. Mentions of other users (e.g. `@john do something`) are ignored — Ryv only responds to its own registered account names.

---

## The `fix` Command — Async Job Pattern

`@ryv fix <description>` is the most powerful command. It runs as a background job so the webhook returns immediately:

```
@ryv fix the hardcoded credentials on line 42
        │
        ▼
Immediate reply (< 100ms):
"⚙️ @ryv is working on it — I'll reply here when the fix PR is ready."
        │
        ▼
Background job:
  1. Fetch PR metadata → get source branch
  2. git fetch origin {sourceBranch}
  3. git worktree add {isolated path} FETCH_HEAD
  4. Build prompt with diff + graph context (blast radius, callers)
  5. Send to OpenCode sidecar
  6. Wait for completion: SSE session.idle OR git-diff stability polling
  7. Read changed files from worktree
  8. createBranch(ryv/fix/{prNumber}-{desc}) from source branch
  9. commitFiles + openPR targeting source branch
        │
        ▼
Follow-up reply posted to the same comment thread:
"@ryv Fix PR opened: https://github.com/.../pull/456

Changed 2 file(s): `src/auth.ts`, `src/config.ts`

> Review carefully before merging."
```

### Job Deduplication

If you mention `@ryv fix` while a job is already running for the same PR, Ryv replies:

> "A fix is already in progress for this PR. Please wait for it to complete."

### Timeout

OpenCode has up to **10 minutes** to complete the fix (5-minute POST timeout + git-diff stability polling up to 10 minutes). If it times out with no file changes, Ryv replies with an explanation.

---

## The `test` Command

`@ryv generate tests` builds a prompt from the PR diff, sends it to OpenCode, and opens a `ryv/test/{prNumber}-…` branch with the generated tests. Same async flow as `fix`.

---

## The `ask` Command

`@ryv what does this service do?` answers questions directly in the comment thread using your codebase's symbol graph for context — no PR or branch creation involved.

---

## The `review` Command

`@ryv re-review this PR` re-runs the full Ryv review pipeline (graph context, multi-agent if enabled, precision filter) and posts a fresh set of inline comments.

---

## OpenCode Sidecar

The `fix` and `test` commands require the **OpenCode sidecar** — a separate service that handles the agentic editing loop (file edits, self-correction).

OpenCode and Ryv share a Docker volume (`repos-data`) so both see the same local repo checkouts. Ryv creates an isolated **git worktree** for each fix job so the main clone is never touched.

### Docker Compose

```yaml
# docker-compose.yml
opencode:
  build:
    context: ./docker/opencode
    dockerfile: Dockerfile
  volumes:
    - repos-data:/repos      # shared with agnus
  environment:
    - OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD}
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
    - OPENAI_API_KEY=${OPENAI_API_KEY:-}
  restart: unless-stopped
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_URL` | `http://opencode:4096` | URL of the OpenCode sidecar. |
| `OPENCODE_SERVER_PASSWORD` | — | Password for the OpenCode HTTP server. Set in both Ryv and OpenCode. |
| `OPENCODE_PROVIDER_ID` | `opencode` | LLM provider OpenCode uses for agentic tasks. Built-in: `opencode` (free proxy). |
| `OPENCODE_MODEL_ID` | `big-pickle` | Model for agentic tasks. OpenCode built-ins: `big-pickle`, `gpt-5-nano`, `mimo-v2-flash-free`. |

If `OPENCODE_URL` is unreachable, `@ryv fix` replies with an error explaining the sidecar is not available.

---

## Rate Limiting

Commands are rate-limited per PR to prevent abuse:

| Variable | Default | Description |
|----------|---------|-------------|
| `COMMANDS_ENABLED` | `true` | Master toggle — set `false` to disable all `@ryv` commands globally. |
| `COMMAND_MAX_PER_HOUR` | `10` | Max commands per PR per hour. |
| `RYV_BOT_NAME` | `ryv` | Comma-separated trigger names (auto-detection appended at runtime). |

---

## Adding New Commands

Three steps — no changes to the dispatcher or webhook handler required:

1. **Write the handler** in `packages/reviewer/src/commands/handlers/<name>.ts`
2. **Register it** in `packages/reviewer/src/commands/registry.ts` with `name`, `description`, and `examples`
3. **Export it** from `packages/reviewer/src/commands/index.ts`

The NLP classifier picks up new commands automatically from the registry description.
