# Testing Guide

## Unit Tests

```bash
# All packages
pnpm test

# Single package
pnpm --filter @agnus-ai/reviewer test
pnpm --filter @agnus-ai/core test
```

Tests live in `__tests__/` within each package and use Jest.

## Manual Smoke Tests (reviewer)

### 1. Basic Review — Dry Run

```bash
GITHUB_TOKEN=$(gh auth token) node packages/reviewer/dist/cli.js review \
  --pr <PR_NUMBER> --repo <owner/repo> --dry-run
```

Expected: Review printed to stdout. No comments posted.

### 2. Incremental Review

Run twice against the same PR:

```bash
# First run — posts comments and stores checkpoint
node packages/reviewer/dist/cli.js review --pr 123 --repo owner/repo --incremental

# Second run — should post zero new comments (checkpoint matches HEAD SHA)
node packages/reviewer/dist/cli.js review --pr 123 --repo owner/repo --incremental
```

Expected second-run output: `No new commits since last review`.

### 3. Deduplication — Config/Data Files Now Reviewed

After Fix A (`*.json`/`*.yaml` removed from `skipPatterns`):

1. Open a PR that modifies `package.json` or a GitHub Actions YAML
2. Run a review
3. Confirm comments land on those files

### 4. Version Claim Filter

The LLM should never comment on package version validity:

1. Open a PR that bumps a dependency version in `package.json`
2. Run a review
3. Confirm no comments say "version X does not exist" or "the latest version is Y"

### 5. Malformed Checkpoint

Corrupt a checkpoint to trigger the warning (Fix H):

```bash
# Manually edit the checkpoint comment body to break the JSON, then run again:
node packages/reviewer/dist/cli.js review --pr 123 --repo owner/repo --incremental
```

Expected: `[AgnusAI] Malformed checkpoint JSON, falling back to full review. Snippet: "..."`.

### 6. Truncated Diff Warning

Test with a very large PR (diff > `maxDiffSize` characters):

```bash
node packages/reviewer/dist/cli.js review --pr <large-pr> --repo owner/repo
```

Expected: Console shows the truncation warning; LLM prompt includes the `⚠️ IMPORTANT` notice.

### 7. Issue ID Collision (Fix D)

Verify two comments with the same first 50 chars but different full bodies produce different IDs:

```bash
node -e "
const { generateIssueId } = require('./packages/reviewer/dist/review/deduplication');
const a = { path: 'src/foo.ts', line: 10, body: 'A'.repeat(50) + '_SUFFIX_A', severity: 'info' };
const b = { path: 'src/foo.ts', line: 10, body: 'A'.repeat(50) + '_SUFFIX_B', severity: 'info' };
console.assert(generateIssueId(a) !== generateIssueId(b), 'IDs must differ!');
console.log('PASS');
"
```

## Manual Smoke Tests (API / hosted mode)

### Register a Repo and Watch SSE Progress

```bash
# Register + trigger full index
curl -X POST http://localhost:3000/api/repos \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/owner/repo","platform":"github","token":"ghp_...","repoPath":"/path/to/local/clone"}'

# Stream indexing progress
curl -N http://localhost:3000/api/repos/<repoId>/index/status
```

Expected SSE stream:
```
data: {"step":"parsing","file":"src/auth.ts","progress":1,"total":150}
data: {"step":"parsing","file":"src/main.ts","progress":2,"total":150}
...
data: {"step":"embedding","symbolCount":235,"progress":32,"total":235}
...
data: {"step":"done","symbolCount":235,"edgeCount":1194,"durationMs":4200}
```

### Simulate a PR Webhook

```bash
PAYLOAD='{"action":"opened","pull_request":{"number":42},"repository":{"html_url":"https://github.com/owner/repo"}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/.*= /sha256=/')

curl -X POST http://localhost:3000/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$PAYLOAD"
```

Expected: Review posted as inline comments on the PR.

### Blast Radius Endpoint

```bash
# symbolId format: filePath:qualifiedName (URL-encoded)
curl http://localhost:3000/api/repos/<repoId>/graph/blast-radius/src%2Fauth.ts%3AloginUser
```

Expected: JSON with `directCallers`, `transitiveCallers`, `affectedFiles`, `riskScore`.

## Checklist After Every Source Change

- `pnpm --filter @agnus-ai/<package> build` — zero TypeScript errors
- Run `--dry-run` on a real PR and inspect the JSON output
- Check console for unexpected `[AgnusAI]` warnings
