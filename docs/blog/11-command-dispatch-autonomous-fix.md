# We Taught the Reviewer to Fix Its Own Findings

*Part 11 of the "Building Ryv" series*

---

[Image]: {A robot sitting in a code review thread, reading a long chain of PR comments. One comment says "@ryv fix the null check on line 42." The robot's expression shifts from reading to focused determination. In the next panel it's already gone — the seat is empty, just a small flame trail where it was. Editorial illustration, noir-ish lighting, single orange glow from a laptop screen.}

The original promise of AI code review was: "It finds the bugs."

That's useful. But if you've shipped a code reviewer into a real engineering team, you know what happens after a finding lands. Someone reads the comment. It's a legitimate issue. And then it sits in the thread for three days while the PR author context-switches, forgets, context-switches back, and eventually writes a fix at 11pm before going to bed.

The finding was right. The review was good. The friction was all in the gap between "found" and "fixed."

We wanted to close that gap.

---

## The Problem with "Just Tell Me What's Wrong"

A code reviewer that only reports findings is a one-way pipe. It produces output into a thread and then stops existing. The developer has to pick up the output and carry it to a new PR, a new commit, a new round of review.

For a trivial fix — a missing `await`, a hardcoded secret that should be an env var, an unvalidated input — the cognitive cost of writing the fix is low. But the *coordination* cost is not. You have to switch context, find the file, apply the change, write the commit message, push the branch, open a PR, link it back to the original thread, wait for CI.

That's a lot of ceremony for a one-line change.

What if you could just type `@ryv fix this` in the review thread and come back to a PR?

---

## What We Built: The @ryv Command System

Every PR comment mentioning `@ryv` (or whatever you've configured as your bot name) now routes through a command dispatcher. The dispatcher takes whatever the developer wrote after the mention and figures out what they actually want.

```
@ryv fix the null check on line 42
@ryv what does the transferBalance function do
@ryv re-review this PR now that I've addressed the JWT issue
@ryv write unit tests for the changed auth middleware
```

These are four completely different operations. They need four completely different handlers. And the text is natural language — not a rigid command syntax.

The dispatcher is a small LLM call. It takes the user's message, lists all registered commands with their descriptions and example phrases, and asks the model to classify the intent:

```typescript
function buildClassifierPrompt(userQuery: string): string {
  const commandList = COMMAND_REGISTRY.map(cmd =>
    `- ${cmd.name}: ${cmd.description}\n  Examples: ${cmd.examples.join('; ')}`
  ).join('\n');

  return [
    'You are an intent classifier for @ryv, an AI code reviewer bot.',
    'The user wrote "@ryv" in a PR comment. Identify their intent.',
    '',
    'Available commands:',
    commandList,
    '',
    `User message: "${userQuery}"`,
    '',
    'Respond with ONLY valid JSON:',
    '{"command": "<name>", "query": "<full user request>", "confidence": <0.0-1.0>}',
    'If unsure, default to "ask".',
  ].join('\n');
}
```

The model returns `{ command: "fix", query: "null check on line 42", confidence: 0.95 }`. Low confidence routes to `ask` — a safe general-purpose fallback that answers questions about the PR using the graph context.

There's also a fast path for exact slash-command syntax: `@ryv /fix`, `@ryv /test`, `@ryv /review`. These bypass the classifier entirely and route directly. Useful if you want predictable, zero-latency dispatch.

---

## The Command Registry

Commands are registered as plain descriptors:

```typescript
{
  name: 'fix',
  description: 'Autonomously fix a specific issue by opening a companion PR',
  examples: ['fix this', 'fix the null check', 'fix the bug on line 42', 'fix the hardcoded credentials'],
  handler: handleFix,
}
```

The registry is what the classifier sees. Adding a new command means adding an entry to the array — no routing tables, no middleware chains, no framework configuration. The handler function gets full context: the PR, the VCS adapter, the LLM backend, and the graph cache entry if the repo is indexed.

Current live commands: `ask`, `review`, `fix`, `test`, `help`. Coming soon: `implement`, `docs`, `changelog`, `ticket_create`, `similar`.

---

## How `@ryv fix` Actually Works

The fix command is where things get genuinely unusual.

When you type `@ryv fix the JWT issue`, the webhook fires within milliseconds. Ryv acknowledges immediately — it posts a reply to the thread while the real work happens in the background:

```
⚙️ @ryv is working on it — I'll reply here when the fix PR is ready.
```

This acknowledgment happens in under 100ms. The webhook response is already gone. The actual fix work runs in a `setImmediate` callback — fully async, not blocking anything.

[Image]: {A timeline diagram showing two parallel tracks. The top track: webhook fires → acknowledge → webhook returns. The bottom track starts simultaneously: fetch PR → create worktree → call OpenCode → poll for stability → commit → open PR → follow-up comment. The two tracks connect at the end with a dotted line labeled "follow-up reply." Clean technical diagram style, blueprint aesthetic.}

Here's what's happening in that background job:

**1. Deduplication check.** Before anything else, we query for an active `fix_jobs` row for this PR. If there's already a fix running, we skip. You can't have two concurrent autonomous fixes fighting over the same branch.

**2. Git worktree.** We create an isolated worktree from the PR's source branch — not the main checkout, not a full clone. A worktree is a second working tree pointing at the same `.git` directory. It's fast (seconds, not minutes), and it's completely isolated from whatever the main checkout is doing. The OpenCode agent will write its changes here.

```bash
git fetch origin feature/my-branch
git worktree add /repos/worktrees/fix-10902-1710000000000 FETCH_HEAD
```

**3. Build the fix prompt.** The prompt contains the full PR diff, the user's exact request (not a sanitized version — the full raw message), graph context from the indexed codebase (callers, callees, blast radius), and explicit constraints about the worktree path where changes should land.

**4. OpenCode sidecar.** OpenCode runs as a Docker sidecar — a separate container on the same network, mounted to the same `/repos` volume. We make a single HTTP call to create a session, pass the prompt, and wait.

OpenCode is a full agentic coding loop. It reads files, writes edits, runs tools, fixes its own errors via LSP feedback. The agent doesn't just find the bug — it edits the source files in the worktree to fix it.

```
POST /session?directory=/repos/worktrees/fix-10902-1710000000000
POST /session/{id}/message { parts: [{ type: "text", text: prompt }] }
```

We race the OpenCode SSE stream against a git-diff stability poller. If OpenCode finishes cleanly, great. If it runs long, we check every 30 seconds whether the worktree has stopped changing — if the files have been stable for two consecutive polls, we consider it done. Either way, we move forward.

**5. Read what changed.** After OpenCode finishes, we run `git diff` against the base branch in the worktree. This gives us the exact set of files that were modified.

**6. Commit and open a PR.** We create a new branch from the source branch (not the target — we want to preserve the original PR structure), commit the changed files through the VCS adapter, and open a PR:

```
fix: null check on line 42 — ryv/fix/10902-null-check-on-line-1abc2d
```

**7. Follow-up comment.** Back in the original PR thread, Ryv posts the fix PR URL:

```
@ryv Fix PR opened: https://dev.azure.com/.../pullrequest/10903

Changed 1 file: `src/authMiddleware.ts`

> Review carefully before merging.
```

The whole cycle — acknowledgment to follow-up — takes two to five minutes depending on how complex the fix is.

---

## What Makes This Hard

The complexity isn't in the happy path. It's in all the ways the background job can fail partway through.

If OpenCode is unavailable, post a message saying so. If the worktree creation fails because the source branch doesn't exist on the remote, post an error. If OpenCode runs for ten minutes and makes no changes, report that and suggest a more specific request. If the PR creation fails because the branch already exists, report that. And in every case: clean up the worktree. Always.

The `fix_jobs` table tracks every job's state — `pending`, `running`, `done`, `failed` — so you can see what's in flight and debug what went wrong. The `finally` block on the main job function always runs worktree cleanup. If the Docker container crashes mid-job, the worktree sits orphaned on disk until the next cleanup pass, but nothing else is corrupted.

---

## The Self-Review Loop: `@ryv review`

The `review` command is simpler but has an interesting twist. It re-triggers the full multi-agent review pipeline on the current state of the PR.

This matters because reviews go stale. A developer addresses the JWT finding, pushes a new commit, and wants to know: did the fix land correctly, and are there any new issues in the commit? Instead of waiting for the next webhook event, they type `@ryv review` and get a fresh review in a few minutes.

The implementation fires an immediate acknowledgment, then calls `triggerReview()` — a callback passed in from the webhook handler that kicks off the exact same pipeline as a webhook-triggered review. No duplication of logic; the same `runReview()` function handles both paths.

---

## `@ryv ask`: Graph-Aware Q&A

The `ask` command is the most-used one in practice. Developers don't always want a full review — sometimes they just want to understand a piece of code.

```
@ryv what does transferBalance do and who calls it
@ryv is this change backwards compatible with the old API
@ryv why would this fail in production
```

The handler fetches the PR, the diff, and the graph context from the indexed codebase, then builds a prompt with the user's question at the top. The answer is posted directly in the thread — no PR, no branch, just a reply.

The graph context is what makes this useful. A question like "who calls this function" gets answered not from the LLM's training data but from the actual symbol graph of the current codebase — with accurate callers, call chains, and blast radius data.

---

## Bot Detection: The Part That's Easy to Miss

One thing you learn quickly when you run a bot that posts PR comments: you have to make sure the bot doesn't respond to itself.

Every time Ryv posts a review comment, the webhook fires. If Ryv's comments trigger commands, you get an infinite loop — Ryv reviews, the review comment fires a webhook, the webhook routes to the command system, the command posts another comment, which fires another webhook.

The solution is straightforward: on every incoming comment event, check whether the author is the configured bot name (`RYV_BOT_NAME`). If it matches, ignore the event. The check happens before anything else in the webhook handler.

```typescript
const isBot = (author: string): boolean =>
  RYV_BOT_NAMES.some(n => author.toLowerCase() === n.toLowerCase())
```

It's a three-line guard. Missing it would be catastrophic. This kind of subtle failure mode is what makes building bot-in-a-loop systems tricky — the happy path works perfectly, and the failure mode only appears in production.

---

## Rate Limiting

The command system has a per-PR rate limit: `COMMAND_MAX_PER_HOUR` (default 10). If a single PR triggers more than ten commands in a rolling hour window, subsequent commands are silently dropped.

This is mostly defensive against misconfiguration — if someone accidentally wires up an automation that spams `@ryv` mentions, you don't want to burn your LLM quota responding to all of them. In practice, real developer workflows don't come anywhere near the limit.

---

## What This Changes

The shift from a reviewer that *reports* to one that *acts* is more significant than it sounds.

When a developer sees `@ryv fix this` in the command list, their mental model of the tool changes. It's no longer a static analysis pass that produces a list of things to do. It's a collaborator that can do some of those things for you.

That changes the conversation around code review adoption. The objection "reviews slow down our PRs" weakens when the reviewer can also close some of the feedback loop it opened. The objection "AI review comments are never actionable" weakens when the AI can act on its own comments.

You still have to review the fix. You still have to approve and merge. The human is still in the loop. But the coordination cost — the context switching, the ceremony, the latency — gets absorbed by the system.

That's the goal. Less friction between finding and fixing. More time spent on the things that actually need a human.

---

*Next: how we built the rules system — letting teams codify their own review standards and enforce them automatically on every PR.*
