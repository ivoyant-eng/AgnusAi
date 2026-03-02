# @agnus Commands Module — Design Plan

> **Status:** Planned (not yet implemented)
> **Branch target:** v3 Phase 3

---

## Why This Exists

AgnusAI currently has one interactive command (`/ask`) hard-wired as a prefix match inside `webhooks.ts`. Competitors (CodeRabbit, Qodo Merge) have rich command sets (8–15 commands), but they all require users to memorize exact slash-command syntax.

Our approach is different: **NLP-first intent classification**. Users write natural language after `@agnus` and a small LLM classification step routes to the right handler automatically. No memorizing commands — just talk to it.

---

## Trigger Syntax

```
@agnus <anything in natural language>
```

**Examples:**
```
@agnus what does this function do?
@agnus create a ticket from this PR
@agnus generate unit tests for the changed files
@agnus update the changelog
@agnus help
```

Legacy `/ask <question>` continues to work as a backward-compatible alias.

---

## Supported Commands (v1)

| Command | What it does | Example phrases |
|---------|--------------|-----------------|
| `ask` | Answer any question about the PR, diff, or codebase using graph context | *"what does this do"*, *"explain the auth change"*, *"why is this needed"* |
| `review` | Trigger a fresh full review of the PR | *"review this"*, *"re-review"*, *"check this again"* |
| `test` | Generate unit tests for the changed code | *"generate tests"*, *"write unit tests"*, *"add test cases"* |
| `docs` | Generate docstrings for changed functions/classes | *"add docs"*, *"generate docstrings"*, *"document this"* |
| `ticket_create` | Create a ticket (Jira / Linear / GitHub Issue / Azure Boards) from this PR | *"create a ticket"*, *"open a Jira issue"*, *"log this as a Linear task"* |
| `changelog` | Append an entry to `CHANGELOG.md` for this PR | *"update changelog"*, *"add a changelog entry"* |
| `similar` | Find semantically similar code in the codebase (via pgvector) | *"find similar code"*, *"are there similar implementations"* |
| `help` | List all available commands with examples | *"help"*, *"what can you do"*, *"list commands"* |

---

## NLP Dispatch Architecture

```
User writes: "@agnus create a ticket from this PR"
                            │
                  webhooks.ts detects @agnus mention
                            │
                  command-runner.ts extracts: "create a ticket from this PR"
                            │
                  CommandDispatcher.dispatch(userQuery)
                  ┌─────────────────────────────────────┐
                  │  LLM classification prompt:          │
                  │  - lists all commands + descriptions │
                  │  - 3 example phrases per command     │
                  │  - asks for JSON {command, query,    │
                  │    confidence}                       │
                  └─────────────────────────────────────┘
                            │
                  → { command: "ticket_create",
                      query: "create a ticket from this PR",
                      confidence: 0.95 }
                            │
                  COMMAND_REGISTRY.find("ticket_create")
                            │
                  handler(context, intent, vcs, llm)
                            │
                  post reply to PR comment thread
```

The dispatcher makes one small LLM call (no PR context needed — just command descriptions + user query). It falls back to `ask` if classification fails or confidence is low.

---

## Module Structure

```
packages/reviewer/src/commands/
├── types.ts          ← CommandContext, CommandIntent, CommandResult, CommandDescriptor
├── registry.ts       ← COMMAND_REGISTRY — ordered list of all descriptors + handlers
├── dispatcher.ts     ← CommandDispatcher.dispatch() — NLP intent classification
├── index.ts          ← barrel export
└── handlers/
    ├── ask.ts        ← Q&A (reuses buildAskPrompt from llm/prompt.ts)
    ├── review.ts     ← triggers runReview() via review-runner.ts
    ├── test.ts       ← generates unit tests from diff
    ├── docs.ts       ← generates docstrings from changed files
    ├── ticket.ts     ← creates ticket via TicketAdapter.createTicket()
    ├── changelog.ts  ← reads CHANGELOG.md, appends entry as suggestion
    ├── similar.ts    ← queries graphEntry.retriever for similar symbols
    └── help.ts       ← posts formatted command list

packages/api/src/
└── command-runner.ts ← bridge: webhook payload → CommandDispatcher → handler → reply
```

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
  threadId?: number;       // Azure: thread to reply into
  token?: string;
  baseBranch: string;
  userQuery: string;       // text after @agnus (trimmed)
  rawMention: string;      // the full original comment body
  pool: Pool;
}

export interface CommandIntent {
  command: string;         // matched command name
  query: string;           // refined query extracted by the classifier
  confidence: number;      // 0.0–1.0
}

export interface CommandResult {
  reply: string;           // markdown to post as the reply comment
}

export type CommandHandler = (
  ctx: CommandContext,
  intent: CommandIntent,
  vcs: VCSAdapter,
  llm: LLMBackend,
  graphEntry?: GraphCacheEntry,
) => Promise<CommandResult>;

export interface CommandDescriptor {
  name: string;
  description: string;     // shown to LLM classifier
  examples: string[];      // few-shot examples for classifier
  handler: CommandHandler;
}
```

---

## How Dispatch Works Internally

```typescript
// packages/reviewer/src/commands/dispatcher.ts

const prompt = `
You are an intent classifier for AgnusAI, an AI code reviewer.
The user wrote "@agnus" in a PR comment. Extract their intent.

Available commands:
- ask: Answer a question about the PR, diff, or codebase
  Examples: what does this do; explain the auth change; why is this needed
- review: Trigger a fresh code review
  Examples: review this; re-review; check this again
- test: Generate unit tests for changed code
  Examples: generate tests; write unit tests; add test cases
... (all 8 commands)

User message: "${userQuery}"

Respond with ONLY valid JSON:
{"command": "<name>", "query": "<refined query>", "confidence": <0.0-1.0>}
If unsure, default to "ask".
`;
```

The dispatcher parses the JSON response. If parsing fails or the command is not in the registry, it falls back to `ask` with `confidence: 0.5`.

---

## Webhook Integration

In `packages/api/src/routes/webhooks.ts`, the existing `handleAskCommand` function is replaced by `handleAgnusCommand`:

```typescript
// Detection (GitHub issue_comment event)
const body = (payload.comment as any)?.body?.trim() ?? '';

const isAgnusMention = body.includes('@agnus');
const isLegacyAsk   = body.startsWith('/ask ');

if (!isAgnusMention && !isLegacyAsk) return false;

if (isLegacyAsk) {
  // Backward-compatible: route directly to ask handler, skip NLP
  const question = body.slice('/ask '.length).trim();
  runCommand({ ..., userQuery: question, forceCommand: 'ask' });
} else {
  // NLP path
  const afterMention = body.split('@agnus')[1]?.trim() ?? '';
  runCommand({ ..., userQuery: afterMention });
}
```

Both GitHub org-slug and plain webhook routes call this new handler.

---

## Handler Notes

### `ask` handler
- Reuses `buildAskPrompt(question, context)` from `packages/reviewer/src/llm/prompt.ts`
- Same logic as current `ask-runner.ts` — this becomes the canonical implementation

### `review` handler
- Posts "Review triggered…" comment immediately
- Calls `runReview()` from `packages/api/src/review-runner.ts` in a `setImmediate` (fire-and-forget, same pattern as the webhook dispatcher)

### `test` handler
- Fetches diff + file contents
- Prompt: injects changed function signatures + bodies, asks for test file skeleton
- Returns tests as a fenced code block inside the reply comment

### `docs` handler
- Reads full file via `vcs.getFileContent()` for each changed file
- Prompt: generate JSDoc/docstrings for the modified symbols
- Returns suggested docstrings as inline suggestion blocks

### `ticket_create` handler
- Generates ticket title + description from PR metadata via LLM
- Calls `TicketAdapter.createTicket({ title, description, prUrl })` on each configured adapter
- `createTicket()` is a new optional method to be added to `TicketAdapter` base interface
- Returns ticket URL in reply, or "No ticket provider configured" if no adapter

### `changelog` handler
- Reads `CHANGELOG.md` via `vcs.getFileContent('CHANGELOG.md', targetBranch)`
- Infers format (Keep a Changelog, date-based, etc.)
- Generates entry via LLM, returns as a fenced code block

### `similar` handler
- Requires `graphEntry` (graph must be indexed)
- Queries `entry.retriever.getReviewContext(diffStr, repoId)` and surfaces top semantic neighbors
- Returns formatted list of similar symbols with file + line references

### `help` handler
- Iterates `COMMAND_REGISTRY`
- Returns a markdown table with command name, description, and one example phrase

---

## Adding New Commands

Three steps:

1. **Write the handler** in `packages/reviewer/src/commands/handlers/<name>.ts`
   ```typescript
   export const handleMyCommand: CommandHandler = async (ctx, intent, vcs, llm, graphEntry) => {
     const reply = '...';
     return { reply };
   };
   ```

2. **Register it** in `packages/reviewer/src/commands/registry.ts`
   ```typescript
   {
     name: 'my_command',
     description: 'Does X when user asks for Y',
     examples: ['do X', 'please do X', 'I need X done'],
     handler: handleMyCommand,
   }
   ```

3. **Export it** from `packages/reviewer/src/commands/index.ts`

No changes needed to the dispatcher, webhook handler, or command-runner. The NLP classifier automatically picks up the new command from the registry description.

---

## Rate Limiting

Inherited from the existing `/ask` rate limiter in `ask-runner.ts`:
- Max 10 `@agnus` interactions per PR per hour (in-memory, per `repoId:prNumber` key)
- Configurable via `ASK_MAX_PER_HOUR` (rename to `COMMAND_MAX_PER_HOUR`)

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COMMANDS_ENABLED` | `true` | Master toggle for @agnus commands |
| `COMMAND_MAX_PER_HOUR` | `10` | Max @agnus calls per PR per hour |
| `AGNUS_BOT_NAME` | `agnus` | Mention trigger (allows custom bot names) |

---

## Files to Create / Modify

### New Files
| File | Description |
|------|-------------|
| `packages/reviewer/src/commands/types.ts` | Core interfaces |
| `packages/reviewer/src/commands/registry.ts` | `COMMAND_REGISTRY` with all 8 descriptors |
| `packages/reviewer/src/commands/dispatcher.ts` | NLP intent classifier |
| `packages/reviewer/src/commands/index.ts` | Barrel export |
| `packages/reviewer/src/commands/handlers/ask.ts` | Q&A handler |
| `packages/reviewer/src/commands/handlers/review.ts` | Re-review handler |
| `packages/reviewer/src/commands/handlers/test.ts` | Test generation handler |
| `packages/reviewer/src/commands/handlers/docs.ts` | Docstring generation handler |
| `packages/reviewer/src/commands/handlers/ticket.ts` | Ticket creation handler |
| `packages/reviewer/src/commands/handlers/changelog.ts` | Changelog update handler |
| `packages/reviewer/src/commands/handlers/similar.ts` | Similar code search handler |
| `packages/reviewer/src/commands/handlers/help.ts` | Help/list handler |
| `packages/api/src/command-runner.ts` | API bridge |

### Modified Files
| File | Change |
|------|--------|
| `packages/api/src/routes/webhooks.ts` | Replace `handleAskCommand` with `handleAgnusCommand`; route through `command-runner.ts` |
| `packages/reviewer/src/index.ts` | Add `export * from './commands'` |
| `packages/reviewer/src/adapters/ticket/base.ts` | Add optional `createTicket()` method |

---

## Relationship to Gap Analysis

This module directly enables several items from `docs/roadmap/competitive-gap-analysis-2026.md`:

| Gap | Command | Priority |
|-----|---------|----------|
| G2 — Test generation | `test` | 🔴 High |
| G5 — Docstring generation | `docs` | 🟠 Medium-High |
| G9 — Auto CHANGELOG | `changelog` | 🟡 Medium |
| G10 — Create ticket from PR | `ticket_create` | 🟡 Medium |
| G15 — Surface similar code | `similar` | 🟡 Medium |
