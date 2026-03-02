# Manual Runners — CodeRabbit & GitHub Copilot

CodeRabbit and GitHub Copilot cannot be triggered programmatically from the benchmark CLI. This doc explains how to collect their output manually and import it into the benchmark results for inclusion in the comparison report.

---

## CodeRabbit

### Setup (one-time)
1. Sign up for a free CodeRabbit account at [coderabbit.ai](https://coderabbit.ai)
2. Install the GitHub App on a test GitHub org/repo you control
3. Configure CodeRabbit to review PRs automatically on open

### Running on test PRs
For each PR in the test suite:
1. Fork the target repo (e.g., `astropy/astropy`) to your test org
2. Create a branch from `base_commit`, apply the diff as a new commit, open a PR
3. CodeRabbit will auto-review within 2–3 minutes
4. Copy the review comment body from the PR

### Importing results
Save each review to a JSON file matching the runner output format:

```json
{
  "tool": "coderabbit",
  "entryId": "astropy-pr-12907",
  "comments": [
    {
      "file": "astropy/coordinates/angles.py",
      "line": 47,
      "body": "Potential None dereference on line 47...",
      "severity": "warning"
    }
  ],
  "summary": "Overall the change looks correct but there is a potential edge case...",
  "durationMs": 145000
}
```

Place the file in `packages/benchmark/results/manual/coderabbit/astropy-pr-12907.json`.

### Run the report with CodeRabbit results included
```bash
pnpm --filter @agnus-ai/benchmark run report -- --include-manual coderabbit
```

---

## GitHub Copilot Code Review

### Setup (one-time)
1. Requires a GitHub Copilot subscription with code review enabled
2. Enable in your test org: Settings → Copilot → Code Review → Enable

### Running on test PRs
Same as CodeRabbit — create PRs on your test fork and wait for Copilot to review.

GitHub Copilot posts as `COMMENT` type (never `REQUEST_CHANGES`). Capture the review the same way.

### Importing results
Same JSON format as above, `"tool": "copilot"`. Place in:
`packages/benchmark/results/manual/copilot/astropy-pr-12907.json`

---

## Automation Note

Both CodeRabbit and Copilot can theoretically be triggered via GitHub webhooks, but:
- CodeRabbit requires a live GitHub PR (can't pass raw diffs)
- Copilot is GitHub-native with no external API

If you want to automate this in the future, the approach would be:
1. Use the GitHub API to create a temporary PR on a private repo
2. Wait for the review (poll PR review events)
3. Collect comments via GitHub API
4. Delete the PR

This adds GitHub API rate limit complexity and is not implemented in the current harness.
