# Comment Reply Threads

## Overview

AgnusAI includes a webhook handler that enables two-way conversations on inline PR comments. When a user replies to an AgnusAI comment, the LLM generates a contextual response taking the full thread history into account.

## Flow

```
User replies to AgnusAI inline comment
        │
        ▼
GitHub delivers pull_request_review_comment webhook event
        │
        ▼
src/webhook/handler.ts
  1. Verify this is a reply to an AgnusAI comment (check AGNUSAI_MARKER)
  2. Fetch full thread history (all comments with same in_reply_to chain)
  3. Build reply prompt with:
     - Original issue context
     - User's reply
     - Prior conversation turns
        │
        ▼
LLM generates contextual response
        │
        ▼
Post reply via GitHub API (comment on same thread)
```

## Dismissal Detection

The handler detects dismissal signals in user replies:

| Signal | Example phrases |
|--------|----------------|
| Won't fix | "wontfix", "won't fix", "will not fix" |
| By design | "as designed", "by design", "intended" |
| False positive | "false positive" |
| Already handled | "resolved", "fixed", "done" |
| Deprioritized | "nit", "nits", "nitpick" |
| Skip | "ignore", "skipping", "skip" |

When a dismissal is detected, the thread is closed gracefully (no further replies posted for this issue).

**Important:** Dismissal is checked on **user reply comments** (`inReplyToId === agnusai_comment.id`), not on the AgnusAI comment's own body. This prevents false self-dismissal when AgnusAI uses words like "fixed" in its own suggestion text.

## AgnusAI Comment Identification

Every AgnusAI comment ends with a hidden markdown marker:

```markdown
[//]: # (AGNUSAI)
```

This allows the webhook handler (and deduplication logic) to distinguish AgnusAI comments from human comments.

## Key Source Files

| File | Role |
|------|------|
| `src/webhook/handler.ts` | GitHub webhook event handler |
| `src/review/reply.ts` | LLM reply prompt construction and generation |
| `src/review/thread.ts` | Thread types, AGNUSAI_MARKER, metadata markers |
| `src/review/deduplication.ts` | `isCommentDismissed()` — checks user replies for dismissal keywords |
