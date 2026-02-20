# Testing Guide

## Unit Tests

```bash
npm test
```

The test suite uses Jest. Tests live in `__tests__/`.

## Manual Smoke Tests

### 1. Basic Review

```bash
GITHUB_TOKEN=$(gh auth token) node dist/cli.js review \
  --pr <PR_NUMBER> --repo <owner/repo> --dry-run
```

Expected: Review printed to stdout, no comments posted.

### 2. Incremental Review

Run twice against the same PR:

```bash
# First run — posts comments and stores checkpoint
node dist/cli.js review --pr 123 --repo owner/repo --incremental

# Second run — should post zero new comments (checkpoint matches HEAD SHA)
node dist/cli.js review --pr 123 --repo owner/repo --incremental
```

Expected second run output: `No new commits since last review`.

### 3. Deduplication — json/yaml Files Now Reviewed

After fix A (`*.json`/`*.yaml` removed from `skipPatterns`):

1. Open a PR that modifies `package.json` or a GitHub Actions YAML
2. Run a review
3. Confirm comments land on those files

Previously these were silently skipped.

### 4. Version Claim Filter

The LLM should never comment on package version validity. Test by:

1. Opening a PR that bumps a dependency version in `package.json`
2. Running a review
3. Confirming no comments say "version X does not exist" or "the latest version is Y"

### 5. Malformed Checkpoint

Corrupt a checkpoint to trigger Fix H warning:

```bash
# After a normal incremental run, find the checkpoint comment ID via GitHub API,
# then manually edit its body to break the JSON, then run again:
node dist/cli.js review --pr 123 --repo owner/repo --incremental
```

Expected: Console prints `[AgnusAI] Malformed checkpoint JSON, falling back to full review. Snippet: "..."`.

### 6. Truncated Diff Warning

Test Fix E by reviewing a very large PR (diff > `maxDiffSize` characters):

```bash
node dist/cli.js review --pr <large-pr> --repo owner/repo
```

Expected: Console output shows the truncation warning; LLM prompt includes the `⚠️ IMPORTANT: This diff was truncated` notice.

### 7. Issue ID Collision Test (Fix D)

Verify that two comments with the same first 50 chars of body but different full bodies produce different IDs:

```bash
node -e "
const { generateIssueId } = require('./dist/review/deduplication');
const a = { path: 'src/foo.ts', line: 10, body: 'A'.repeat(50) + 'DIFFERENT_SUFFIX_A', severity: 'info' };
const b = { path: 'src/foo.ts', line: 10, body: 'A'.repeat(50) + 'DIFFERENT_SUFFIX_B', severity: 'info' };
console.log(generateIssueId(a));
console.log(generateIssueId(b));
console.assert(generateIssueId(a) !== generateIssueId(b), 'IDs must differ!');
console.log('PASS: different IDs for different bodies');
"
```

### 8. Stress Test — Large PR

For a PR touching 50+ files:

1. Run with default config — confirm the `maxComments: 25` cap is respected
2. Run with `--output json` — check `filtered` array explains why comments were dropped
3. Confirm no phantom comments on files outside the diff

## What to Check After Every Source Change

- `npm run build` — zero TypeScript errors
- Run `--dry-run` on a real PR and inspect JSON output
- Check console for unexpected `[AgnusAI]` warnings
