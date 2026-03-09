 Network is blocked in this environment, so installing
  @fastify/rate-limit i# Incremental Reviews

## Overview

With `--incremental`, AgnusAI tracks review state using a **checkpoint** stored as an HTML comment embedded in the PR. On subsequent runs, only commits added since the last checkpoint are reviewed.

## How It Works

```
First run
  1. Fetch full diff for HEAD SHA
  2. Generate review → post comments
  3. Write checkpoint: { sha: HEAD_SHA, timestamp, filesReviewed, commentCount, verdict }
     → stored as: <!-- AGNUSAI_CHECKPOINT:{...} --> in a PR comment

Subsequent run
  1. Find checkpoint comment (newest by timestamp)
  2. Compare checkpoint.sha with current HEAD SHA
  3. Fetch diff only for commits since checkpoint.sha
  4. Skip files unchanged since last checkpoint
  5. Run deduplication against existing comments
  6. Post new comments, update checkpoint
```

## Checkpoint Format

Checkpoints are serialized as an HTML comment so they survive PR comment rendering:

```
<!-- AGNUSAI_CHECKPOINT:{"sha":"abc1234","timestamp":1700000000,"filesReviewed":["src/foo.ts"],"commentCount":3,"verdict":"comment"} -->
```

The checkpoint is embedded in a human-readable PR comment body alongside a summary:

```markdown
## 🔍 AgnusAI Review Checkpoint

**Last reviewed commit:** `abc1234`
**Reviewed at:** 2024-01-01T00:00:00.000Z
**Files reviewed:** 3
**Comments:** 5
**Verdict:** 💬 Commented

---
*This checkpoint enables incremental reviews. New commits will only trigger review of new changes.*
```

## Staleness Detection

A checkpoint is considered stale if:
- It is older than 30 days (`isCheckpointStale`)
- The checkpoint SHA is not in the current commit history (force push detection via `validateCheckpointSha`)

When stale, the system falls back to a full review and writes a new checkpoint.

## Error Handling

If checkpoint JSON is malformed, `parseCheckpoint` logs a warning and returns `null`, triggering a full review:

```
[AgnusAI] Malformed checkpoint JSON, falling back to full review. Snippet: "..." Error: Unexpected token
```

## Key Source Files

| File | Role |
|------|------|
| `src/review/checkpoint.ts` | Parse, serialize, create, find checkpoint comments |
| `src/index.ts` | Incremental diff fetching logic |
| `src/review/deduplication.ts` | Skip unchanged-line comments |
