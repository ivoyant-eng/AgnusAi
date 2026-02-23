# Webhooks

AgnusAI listens for push and pull request events from GitHub and Azure DevOps.

## GitHub

### `POST /api/webhooks/github`

Verifies the `X-Hub-Signature-256` HMAC header using `WEBHOOK_SECRET`.

#### Push Event

Triggered on every commit push. Re-indexes only changed files.

```json
{
  "action": "push",
  "commits": [
    {
      "added": ["src/new-file.ts"],
      "modified": ["src/existing.ts"],
      "removed": ["src/old.ts"]
    }
  ],
  "repository": {
    "html_url": "https://github.com/owner/repo"
  }
}
```

Behavior: calls `indexer.incrementalUpdate(changedFiles, repoId)` asynchronously.

#### Pull Request Event

Triggered on `opened` and `synchronize` actions.

```json
{
  "action": "opened",
  "pull_request": {"number": 42},
  "repository": {"html_url": "https://github.com/owner/repo"}
}
```

Behavior: calls `runReview({ platform, repoId, repoUrl, prNumber, token })` asynchronously. The review is posted as inline GitHub review comments.

### Security

Webhook signatures are verified using `crypto.timingSafeEqual` to prevent timing attacks:

```
X-Hub-Signature-256: sha256=<HMAC-SHA256(WEBHOOK_SECRET, rawBody)>
```

If `WEBHOOK_SECRET` is not set, signature verification is skipped (development only — always set in production).

## Azure DevOps

### `POST /api/webhooks/azure`

No signature verification (Azure uses service hook tokens configured separately).

#### Push Event (`git.push`)

```json
{
  "eventType": "git.push",
  "resource": {
    "commits": [{"changes": [{"item": {"path": "/src/file.ts"}}]}],
    "repository": {"remoteUrl": "https://dev.azure.com/org/project/_git/repo"}
  }
}
```

#### Pull Request Events

- `git.pullrequest.created` → triggers review on new PRs
- `git.pullrequest.updated` → triggers review on new commits

```json
{
  "eventType": "git.pullrequest.created",
  "resource": {
    "pullRequestId": 42,
    "repository": {"remoteUrl": "https://dev.azure.com/org/project/_git/repo"}
  }
}
```

## Testing Webhooks Locally

Use [smee.io](https://smee.io) or [ngrok](https://ngrok.com) to forward GitHub webhooks to `localhost:3000`.

### With smee.io

```bash
npm install -g smee-client
smee --url https://smee.io/your-channel --target http://localhost:3000/api/webhooks/github
```

### Simulate a PR webhook manually

```bash
PAYLOAD='{"action":"synchronize","pull_request":{"number":42},"repository":{"html_url":"https://github.com/owner/repo"}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/.*= /sha256=/')

curl -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$PAYLOAD"
```
