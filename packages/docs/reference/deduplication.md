# Smart Deduplication

Before posting a comment, AgnusAI applies several deduplication layers to avoid spamming the PR with redundant feedback.

## Deduplication Layers

### 1. Same-line Deduplication

If a comment on the same file + line already exists in the PR (from a previous review run), the new comment is skipped entirely.

### 2. Dismissed Comment Awareness

If a reviewer dismissed a previous AgnusAI comment (GitHub's "dismiss review" action), the same issue will not be re-raised on the same line.

### 3. Binary File Skip

Files detected as binary (images, compiled artifacts, lock files) are never reviewed.

### 4. Generated File Skip

Files matching common generated-file patterns are skipped:
- `*.min.js`, `*.bundle.js`
- `dist/**`, `build/**`
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- Auto-generated proto files

### 5. LLM Response Deduplication

If the LLM returns two comments with the same suggestion for the same file (can happen with large diffs), only one is posted.

## Decision Table

| Condition | Action |
|-----------|--------|
| Comment already exists at file:line | Skip |
| Previous comment was dismissed | Skip |
| File is binary | Skip entire file |
| File matches generated pattern | Skip entire file |
| Duplicate in LLM response | Keep first, skip rest |
| All checks pass | Post comment |
