# Incremental Reviews

AgnusAI tracks which commit was last reviewed using a hidden checkpoint comment in the PR. On subsequent pushes, only new changes since the last review are re-reviewed.

## How It Works

After every review, a checkpoint comment is posted (or updated) on the PR:

```html
<!-- AGNUSAI_CHECKPOINT: {
  "sha": "abc1234",
  "timestamp": 1771779289,
  "filesReviewed": ["src/auth.ts", "lib/utils.ts"],
  "commentCount": 4,
  "verdict": "request_changes"
} -->

## 🔍 AgnusAI Review Checkpoint

**Last reviewed commit:** `abc1234`
...
```

On the next review run, the agent:
1. Reads the checkpoint from existing PR comments
2. Compares the checkpoint SHA to the current HEAD
3. Only reviews files that changed **since the checkpoint commit**
4. Updates the checkpoint after the new review

## Benefits

- No duplicate comments on unchanged files
- Faster reviews on large PRs with incremental commits
- Clear audit trail of what was reviewed when

## CLI Flag

```bash
# Always review all files (ignore checkpoint)
node dist/cli.js review --pr 42 --repo owner/repo --no-incremental

# Default behavior (incremental enabled)
node dist/cli.js review --pr 42 --repo owner/repo
```

## Webhook Behavior

The hosted service always reviews incrementally. When a `pull_request.synchronize` event arrives, only the diff since the last reviewed commit is sent to the LLM.
