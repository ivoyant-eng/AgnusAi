# Smart Deduplication

## Overview

Before posting any comment, AgnusAI applies multiple layers of filtering to prevent noise, duplicates, and false positives. The primary entry point is `filterComments()` in `src/review/deduplication.ts`.

## Filter Layers (in order)

| Layer | Check | Reason Code |
|-------|-------|-------------|
| 1 | Invalid line number (`NaN`, `0`, or negative) | `invalid_line_number` |
| 2 | Empty comment body | `empty_comment` |
| 3 | LLM version-existence claim (knowledge cutoff) | `version_claim` |
| 4 | File matches skip pattern (binary, generated, lock) | `binary_file` / `generated_file` / `skip_pattern` |
| 5 | File not in diff (deleted or renamed) | `file_deleted` / `file_renamed` |
| 6 | Line not in diff (unchanged line) | `line_not_in_diff` |
| 7 | Line was deleted | `line_deleted` |
| 8 | Same (path, line) already has an AgnusAI comment | `duplicate_line` |
| 9 | Same issue ID already exists (possibly moved line) | `code_changed` |
| 10 | Issue was dismissed via user reply | `dismissed` |
| 11 | Max comments per file exceeded | `max_comments_per_file` |
| 12 | Test file + non-error severity | `test_file_lenient` |
| PR-level | Draft PR | `draft_pr` |
| PR-level | Max total comments reached | `max_comments_reached` |

## File Skip Patterns

### `ALWAYS_SKIP_PATTERNS` (hardcoded, never reviewable)

- Binary files: images, fonts, archives, compiled assets
- Lock files: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, etc.
- Minified files: `*.min.js`, `*.min.css`
- Generated type definitions: `*.d.ts`, `*.d.ts.map`
- Protocol Buffers output: `*.pb.ts`, `*_pb.ts`, `*.pb.js`, `*_pb.js`
- GraphQL / Apollo codegen: `*.generated.ts`, `*.gen.ts`, `__generated__/`

### `DEFAULT_DEDUP_CONFIG.skipPatterns` (configurable)

User-facing list for files that are technically reviewable but usually low-value:

- Binary assets: `*.png`, `*.jpg`, `*.svg`, `*.pdf`, `*.zip`
- Minified bundles: `*.min.js`, `*.min.css`
- Type definition maps: `*.d.ts`, `*.d.ts.map`
- Lock files (explicit glob): `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`
- Build output dirs: `dist/**`, `build/**`, `out/**`, `.next/**`
- Vendored code: `node_modules/**`, `vendor/**`
- Known generated file patterns: `*.generated.*`, `*.gen.*`, `*.pb.go`, `*_pb2.py`

**Note:** `*.json`, `*.yaml`, `*.yml`, `*.toml`, `*.ini` were **removed** from this list. Config files like `package.json`, `tsconfig.json`, and GitHub Actions YAMLs often contain meaningful, reviewable changes.

## Issue ID Generation

`generateIssueId(comment)` produces a stable ID for deduplication across runs:

```typescript
const content = `${comment.path}:${comment.line}:${comment.body}`;
return 'issue-' + createHash('sha256').update(content).digest('hex').slice(0, 16);
```

SHA-256 over the full body prevents the collision-prone 32-bit djb2 hash that existed before.

## Version Claim Filter

`containsVersionClaim(body)` matches LLM responses that make unreliable assertions about package versions:

- "version X does not exist / is invalid"
- "the latest version is X.Y"
- "as of current releases, X is at version"
- "there is no version X"

These are filtered because the LLM's training data has a cutoff date and package versions change constantly.

## Dismissal Detection

`isCommentDismissed(comment, allComments)` checks whether a user has replied to an AgnusAI comment with a dismissal phrase. It looks at **replies** (`c.inReplyToId === comment.id`), not the AgnusAI comment's own body.

## Configuration

`DEFAULT_DEDUP_CONFIG` values:

| Field | Default | Description |
|-------|---------|-------------|
| `maxComments` | 25 | Maximum total comments per PR |
| `maxCommentsPerFile` | 5 | Maximum comments on a single file |
| `skipDrafts` | `true` | Skip draft PRs entirely |
| `lenientOnTests` | `true` | Only post errors on test files |
| `updateExistingComments` | `true` | Update existing comment if better suggestion available |
| `staleCheckpointThreshold` | 20 | Max commits before checkpoint is considered stale |
