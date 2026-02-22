# Comment Reply Threads

AgnusAI can respond to replies on its own review comments, maintaining a conversation thread directly in the PR.

## How It Works

1. AgnusAI posts an inline review comment on a PR
2. A developer replies to that comment
3. GitHub sends a `pull_request_review_comment` webhook event
4. AgnusAI detects that the reply is on one of its own comments
5. AgnusAI generates a context-aware response and posts it in the thread

## Setup

Add the `pull_request_review_comment` event to your webhook configuration in GitHub:
- **Settings** → **Webhooks** → edit your webhook → add `Pull request review comments`

## What It Can Do

- Explain its reasoning behind a suggestion
- Acknowledge that a suggestion doesn't apply ("fair point, this is intentional")
- Provide alternative implementations
- Answer questions about the identified issue

## What It Cannot Do

- Modify or delete its own previous comments
- Access code outside the PR diff (unless graph context is available)
- Remember previous conversations across different PRs
