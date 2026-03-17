# Agentic Commands Sprint

> **Status:** ✅ Implemented — v3 Phase 2
> **Execution engine:** OpenCode sidecar — handles the full agentic loop (file edits, self-correction). Ryv handles graph context injection, async job tracking, PR creation, and webhook routing.
> **Constraint:** PRs opened by Ryv always require human approval before merge.

---

## Architecture (as implemented)

```
PR comment: "@ryv fix the null check on line 45"
                │
                ▼
  webhooks.ts: isBotMentioned(body, token, platform)
  ├── check RYV_BOT_NAMES list (fast path, no network)
  └── resolveBotDisplayName(token, platform) if no static match
      → caches display name per token (one API call per restart)
                │ matches → route to command-runner
                ▼
  command-runner.ts: strip @mention prefix → userQuery
                │
                ▼
  CommandDispatcher (NLP intent classification via LLM) → "fix"
                │
                ▼
  handleFix (packages/reviewer/src/commands/handlers/fix.ts)
  ├── 1. Validate: repo indexed locally, no job already running
  ├── 2. INSERT fix_jobs row (status = 'pending')
  ├── 3. Return immediately: { reply: "⚙️ Working on it..." }   ← <100ms
  └── 4. setImmediate → runFixJob (background)
          ├── a. vcs.getPR → get sourceBranch
          ├── b. git fetch origin {sourceBranch}
          ├── c. git worktree add {worktreePath} FETCH_HEAD
          ├── d. Build prompt (PR diff + graph context + worktree path)
          ├── e. Race:
          │       callOpenCode(url, password, worktreePath, prompt, 300_000ms)
          │       vs pollUntilStable(worktreePath, 30s intervals, 20 attempts, 2 stable rounds)
          ├── f. gitDiffFiles(worktreePath, baseBranch) → changedFiles
          ├── g. vcs.createBranch(ryv/fix/{prNumber}-{desc}-{ts36}, sourceBranch)
          ├── h. vcs.commitFiles(branchName, [{path, content}], message)
          ├── i. vcs.openPR({ head: branchName, base: sourceBranch })
          ├── j. postFollowUp → "Fix PR opened: {url}"
          └── k. git worktree remove --force (cleanup)
```

**Ryv owns:** graph context injection, async job tracking, PR creation, webhook routing, comment replies, rate limiting, bot identity resolution.
**OpenCode owns:** file editing, agentic loop, self-correction within the worktree.

---

## Async Job Pattern

The fix handler uses a **fire-and-forget** pattern so the webhook response is immediate:

1. **Immediate ACK (`< 100ms`):** inserts `fix_jobs` row → replies "⚙️ Working on it..."
2. **Background job (`setImmediate`):** full OpenCode + git + PR workflow
3. **Follow-up reply:** posted to the original comment thread when the job completes (or fails)

### fix_jobs Table

```sql
CREATE TABLE IF NOT EXISTS fix_jobs (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
  pr_number     INT  NOT NULL,
  platform      TEXT NOT NULL,
  thread_id     INT,
  comment_id    INT  NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  worktree_path TEXT,
  branch_name   TEXT,
  pr_url        TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Deduplication:** if a job is already `pending` or `running` for the same `(repo_id, pr_number)`, a second `@ryv fix` returns "A fix is already in progress" immediately.

---

## Completion Detection — `pollUntilStable`

OpenCode's SSE stream (`session.idle` event) is used as the primary completion signal. As a fallback, `pollUntilStable` races against it:

```
Every 30 seconds, run: git diff --stat HEAD (in worktree)
If output is identical for 2 consecutive rounds → declare done
Max: 20 attempts × 30s = 10 minutes total
```

Whichever fires first (SSE or poll) wins — the other is abandoned when the worktree is cleaned up.

```typescript
// packages/reviewer/src/commands/handlers/shared.ts
export async function pollUntilStable(
  repoPath: string,
  intervalMs = 30_000,
  maxAttempts = 20,
  stableRounds = 2,
): Promise<{ stable: boolean; timedOut: boolean }>
```

---

## Bot Name Auto-Detection

**No config required.** Ryv resolves the display name of the service account that owns the PAT/OAuth token by calling the VCS platform API once per server restart:

- **Azure DevOps:** `GET /_apis/connectionData` → `authenticatedUser.providerDisplayName`
- **GitHub:** `GET https://api.github.com/user` → `login`

The resolved name is cached in memory per token. So if your Azure service account is "AI Agents", mentioning `@AI Agents` triggers Ryv — no extra config needed.

**Additional names** via env var (comma-separated):
```env
RYV_BOT_NAME=ryv,AI Agents,agnus
```

**Security:** `@Ashish do something` is ignored — Ryv only responds to its own registered token name or names in `RYV_BOT_NAME`.

---

## Docker Compose — OpenCode Sidecar (as deployed)

```yaml
# docker-compose.yml
  opencode:
    build:
      context: ./docker/opencode
      dockerfile: Dockerfile
    volumes:
      - repos-data:/repos          # shared with agnus — same checkouts
    environment:
      - OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
    ports:
      - "4096"
    restart: unless-stopped
    networks:
      - agnus-network
```

The OpenCode sidecar is built from a **custom Dockerfile** (`docker/opencode/Dockerfile`) rather than a pre-built image, installing OpenCode via the official installer script. This avoids dependency on third-party community images.

**OpenCode config** (`opencode.json` — all permissions auto-allowed, Ryv is the human-in-the-loop):

```json
{
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "anthropic/claude-haiku-4-5",
  "permission": { "*": "allow" },
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0",
    "password": "${OPENCODE_SERVER_PASSWORD}"
  }
}
```

---

## OpenCode Integration — `callOpenCode`

Implemented in `packages/reviewer/src/commands/handlers/shared.ts` as a function (not a class):

```typescript
export async function callOpenCode(
  baseUrl: string,
  password: string,
  worktreePath: string,
  prompt: string,
  timeoutMs = 600_000,
): Promise<{ output: string; timedOut: boolean }>
```

**Flow:**
1. `POST /session` — creates a session (directory metadata only; actual edits go to `worktreePath` via prompt instructions)
2. `POST /session/{id}/message` — sends graph-context-enriched prompt
3. SSE stream `GET /session/{id}/event` — listens for `{ payload: { type: "session.idle" } }` to signal completion
4. Returns `{ output, timedOut }` — caller uses `timedOut` to craft the failure message

**Prompt includes absolute worktree path** so OpenCode writes to the correct isolated checkout, not the main clone.

---

## Prompt Construction — Graph Context Injection

`buildFixPrompt()` in `packages/reviewer/src/commands/handlers/shared.ts`:

```typescript
function buildFixPrompt({ request, prTitle, prDescription, diff, graphContext, baseBranch, worktreePath }): string
```

Includes:
- **Working directory** — absolute path of the git worktree (required for OpenCode to edit the right files)
- **Task** — user's original request
- **PR diff** — what changed in this PR
- **Codebase graph context** — changed symbols, direct callers (blast radius), prior team examples
- **Instructions** — do not break callers, all changes must be in `{worktreePath}`, commit at the end

---

## Prompt Construction — Graph Context Injection

`buildFixPrompt()` in `packages/reviewer/src/commands/handlers/shared.ts`:

The key differentiator: OpenCode gets the agentic execution engine, Ryv injects codebase intelligence OpenCode can't have on its own (blast radius, caller graph, team prior examples).

---

## Implemented Commands

| Command | Status | Notes |
|---------|--------|-------|
| `@ryv fix <description>` | ✅ Live | Async job → OpenCode → worktree → PR |
| `@ryv generate test` | ✅ Live | Same flow, `ryv/test/…` branch |
| `@ryv ask <question>` | ✅ Live | Q&A using graph context, no OpenCode |
| `@ryv review` | ✅ Live | Triggers `runReview()` pipeline |
| `@ryv help` | ✅ Live | Posts command table |
| `@ryv implement <desc>` | 🔜 Planned | Needs ticket adapter integration |
| `@ryv update ticket` | 🔜 Planned | Needs TicketAdapter |

---

## Branch Naming

```
ryv/fix/{prNumber}-{shortDesc}-{Date.now().toString(36)}
```

- `shortDesc` — first 30 chars of intent.query, alphanumeric + hyphens only
- Base36 timestamp suffix — prevents collision on retry (second fix attempt for same query gets a unique branch name)
- Always branched from **`sourceBranch`** (the PR's head branch), not `baseBranch` — the modified files must exist at the base commit for `changeType: 'edit'` to work in the Azure VCS adapter

---

## Files Delivered

### New Files

| File | Status | Purpose |
|------|--------|---------|
| `packages/reviewer/src/commands/types.ts` | ✅ | CommandContext, CommandIntent, CommandResult, CommandHandler |
| `packages/reviewer/src/commands/registry.ts` | ✅ | COMMAND_REGISTRY — all commands, handlers, NLP examples |
| `packages/reviewer/src/commands/dispatcher.ts` | ✅ | NLP intent classifier (LLM → JSON intent) |
| `packages/reviewer/src/commands/index.ts` | ✅ | Barrel export |
| `packages/reviewer/src/commands/handlers/ask.ts` | ✅ | Q&A via graph context |
| `packages/reviewer/src/commands/handlers/review.ts` | ✅ | Triggers runReview() |
| `packages/reviewer/src/commands/handlers/fix.ts` | ✅ | Async job: OpenCode → worktree → PR |
| `packages/reviewer/src/commands/handlers/test.ts` | ✅ | Test generation via OpenCode |
| `packages/reviewer/src/commands/handlers/help.ts` | ✅ | Posts formatted command table |
| `packages/reviewer/src/commands/handlers/shared.ts` | ✅ | callOpenCode, pollUntilStable, buildFixPrompt, getLocalRepoPath |
| `packages/api/src/command-runner.ts` | ✅ | Webhook payload → dispatcher → handler → reply |

### Modified Files

| File | Change |
|------|--------|
| `packages/api/src/routes/webhooks.ts` | Bot mention detection, auto-resolve display name, route to command-runner |
| `packages/api/src/index.ts` | `fix_jobs` table migration added |
| `packages/reviewer/src/adapters/vcs/azure-devops.ts` | `createBranch` (with updateStatus body check), `commitFiles`, `openPR` |
| `packages/reviewer/src/adapters/vcs/github.ts` | `createBranch`, `commitFiles`, `openPR` |
| `packages/reviewer/src/adapters/vcs/base.ts` | Added optional `createBranch`, `commitFiles`, `openPR` to VCSAdapter interface |
| `docker-compose.yml` | Added `opencode` sidecar service, `repos-data` volume shared |
| `.env.example` | Added `OPENCODE_URL`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_PROVIDER_ID`, `OPENCODE_MODEL_ID`, `RYV_BOT_NAME`, `COMMANDS_ENABLED`, `COMMAND_MAX_PER_HOUR` |

---

## Known Limitations / Future Work

- **`test` handler** — currently synchronous (not yet migrated to async job pattern like `fix`); will be migrated in a follow-up
- **Blast radius verification** — planned but not yet implemented: after OpenCode finishes, run targeted `tsc --noEmit` on changed files + blast radius callers, retry once on failure
- **Ephemeral branch graph indexing** — planned: index the fix branch for accurate blast radius on the fix itself; clean up on PR close webhook
- **`implement` and `update ticket` handlers** — planned; need ticket adapter (Jira/Linear/GitHub Issues) integration
