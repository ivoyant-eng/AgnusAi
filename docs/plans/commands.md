# @ryv Command System

> **Status:** ✅ Implemented — v3 Phase 2
> **Bot name:** `@ryv` (default) — configurable and auto-detected from token

---

## Overview

The `@ryv` command system lets developers write natural language in PR comments and have Ryv act on it. A small LLM classification step routes to the right handler automatically — no memorizing exact syntax.

**Trigger syntax:**
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

## Bot Name — Auto-Detection

**No config required.** Ryv resolves the display name of the service account that owns the PAT/OAuth token by calling the VCS platform API at first use:

- **Azure DevOps:** `GET https://dev.azure.com/{org}/_apis/connectionData` → `authenticatedUser.providerDisplayName`
- **GitHub:** `GET https://api.github.com/user` → `login` / `name`

The resolved name is cached per token (one API call per server restart). So if your Azure DevOps service account is named "AI Agents", mentioning `@AI Agents` triggers Ryv automatically — even without setting `RYV_BOT_NAME`.

**Additional / custom names** — comma-separated list:
```env
RYV_BOT_NAME=ryv,AI Agents,agnus
```

Any of the configured names OR the auto-resolved account name triggers the bot.

**Security:** `@Ashish do something` is ignored — Ryv only responds to its own registered account name or names in `RYV_BOT_NAME`.

---

## Implemented Commands

| Command | Status | What it does |
|---------|--------|--------------|
| `ask` | ✅ Live | Answer any question about the PR, diff, or codebase using graph context |
| `review` | ✅ Live | Trigger a fresh full review of the PR |
| `fix` | ✅ Live | Autonomously fix a specific issue — opens a companion PR |
| `test` | ✅ Live | Generate unit tests for the changed code via OpenCode |
| `help` | ✅ Live | List all available commands with examples |
| `implement` | 🔜 Coming soon | Implement a feature from description or ticket |
| `docs` | 🔜 Coming soon | Generate docstrings for changed functions/classes |
| `changelog` | 🔜 Coming soon | Append an entry to CHANGELOG.md |
| `ticket_create` | 🔜 Coming soon | Create a ticket in Jira / Linear / GitHub Issues |
| `similar` | 🔜 Coming soon | Find semantically similar code via pgvector |

---

## Module Structure

```
packages/reviewer/src/commands/
├── types.ts          — CommandContext, CommandIntent, CommandResult, CommandDescriptor
├── registry.ts       — COMMAND_REGISTRY — all commands, handlers, NLP examples
├── dispatcher.ts     — NLP intent classifier (LLM call → JSON intent)
├── index.ts          — barrel export
└── handlers/
    ├── ask.ts        — Q&A using graph context
    ├── review.ts     — triggers runReview() via review-runner.ts
    ├── fix.ts        — async job: OpenCode → worktree → PR (see below)
    ├── test.ts       — test generation via OpenCode
    └── help.ts       — posts formatted command table

packages/api/src/
├── command-runner.ts — bridge: webhook payload → CommandDispatcher → handler → reply
└── routes/webhooks.ts — detects @ryv mentions, routes to command-runner
```

---

## NLP Dispatch Flow

```
User writes: "@ryv fix the hardcoded credentials"
                         │
              webhooks.ts: isBotMentioned(body, token, platform)
              ├── check RYV_BOT_NAMES list (fast path, no network)
              └── resolveBotDisplayName(token, platform) if needed
                         │ matches → route to command-runner
                         │
              command-runner.ts: extract userQuery (strip @mention prefix)
                         │
              dispatchCommand(userQuery, llm)
              ┌──────────────────────────────────────────┐
              │  LLM classification prompt:              │
              │  - lists all commands + descriptions     │
              │  - 3 example phrases per command         │
              │  - asks for JSON {command, query,        │
              │    confidence}                           │
              └──────────────────────────────────────────┘
                         │
              → { command: "fix",
                  query: "fix the hardcoded credentials",
                  confidence: 0.94 }
                         │
              COMMAND_REGISTRY.find("fix") → handleFix(ctx, intent, vcs, llm)
                         │
              returns { reply: "⚙️ Working on it..." }   ← posted immediately
                         │
              background job runs (setImmediate)
              → fix PR opened, follow-up reply posted
```

Falls back to `ask` if confidence < 0.5 or command not found in registry.

---

## Key Types

```typescript
// packages/reviewer/src/commands/types.ts

export interface CommandContext {
  platform: 'github' | 'azure';
  repoId: string;
  repoUrl: string;
  prNumber: number;
  commentId: number;
  threadId?: number;     // Azure: thread to reply into
  token?: string;
  baseBranch: string;
  userQuery: string;     // text after @ryv (trimmed)
  rawMention: string;    // full original comment body
  pool: unknown;         // Postgres pool (opaque to avoid pg dep in reviewer)
}

export interface CommandIntent {
  command: string;        // matched command name
  query: string;          // refined query from classifier
  confidence: number;     // 0.0–1.0
}

export interface CommandResult {
  reply: string;          // markdown to post as reply comment
}

export type CommandHandler = (
  ctx: CommandContext,
  intent: CommandIntent,
  vcs: VCSAdapter,
  llm: LLMBackend,
  graphEntry?: GraphCacheEntry,
) => Promise<CommandResult>;
```

---

## Handler Notes

### `ask` handler
- Reuses `buildAskPrompt(question, context)` from the LLM prompt builder
- Returns a markdown answer directly in the comment reply

### `review` handler
- Posts "Review triggered…" reply immediately
- Calls `runReview()` from `review-runner.ts` via `setImmediate` (fire-and-forget)

### `fix` handler — Async Job Pattern
The fix handler returns immediately with an ACK and runs the actual work as a background job:

1. **Immediate return** (`< 100ms`): inserts `fix_jobs` row → replies "⚙️ Working on it..."
2. **Background** (`setImmediate`):
   - Creates isolated git worktree from the PR's source branch
   - Calls OpenCode sidecar with graph-context-enriched prompt
   - Races `callOpenCode` (SSE) against `pollUntilStable` (git diff every 30s)
   - When either signals completion, reads changed files, creates branch from source branch, commits, opens PR
   - Posts follow-up reply with PR URL
   - Cleans up worktree in `finally`
3. **Job tracking:** `fix_jobs` table in Postgres — deduplicates concurrent requests, tracks status (`pending` → `running` → `done`/`failed`)

See `packages/reviewer/src/commands/handlers/fix.ts` and `agentic-commands-sprint.md` for full details.

### `test` handler
- Builds prompt from the PR diff + context
- Sends to OpenCode via `callOpenCode` (same flow as fix, but creates `ryv/test/…` branch)
- Currently synchronous (not yet async job); will migrate to same pattern as fix

### `help` handler
- Iterates `COMMAND_REGISTRY`, skips `comingSoon` entries
- Returns a markdown table with command name, description, example phrase

---

## Rate Limiting

`command-runner.ts` rate limits per `repoId:prNumber`:
- Default: max 10 commands per PR per hour
- Configurable: `COMMAND_MAX_PER_HOUR=20`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RYV_BOT_NAME` | `ryv` | Comma-separated list of trigger names. Auto-detection appended at runtime. |
| `COMMANDS_ENABLED` | `true` | Master toggle — set to `false` to disable all @ryv commands |
| `COMMAND_MAX_PER_HOUR` | `10` | Rate limit per PR per hour |

---

## Adding New Commands

Three steps:

1. **Write the handler** in `packages/reviewer/src/commands/handlers/<name>.ts`:
   ```typescript
   export const handleMyCommand: CommandHandler = async (ctx, intent, vcs, llm, graphEntry) => {
     return { reply: '...' }
   }
   ```

2. **Register it** in `packages/reviewer/src/commands/registry.ts`:
   ```typescript
   {
     name: 'my_command',
     description: 'Does X when user asks for Y',
     examples: ['do X', 'please do X', 'I need X done'],
     handler: handleMyCommand,
   }
   ```

3. **Export it** from `packages/reviewer/src/commands/index.ts`

No changes needed to the dispatcher, webhook handler, or command-runner. The NLP classifier picks up the new command automatically from the registry description.
