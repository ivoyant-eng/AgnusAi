# Known Issues & LLM Blindspots

This page tracks all identified blindspots — root causes of false positives (hallucinated comments) or false negatives (real issues silently skipped) — and their fix status.

---

## Fixed Issues

### A — Config/data files silently skipped ✅

**Symptom:** `package.json`, `tsconfig.json`, GitHub Actions YAMLs received no comments even when meaningfully changed.

**Root cause:** `DEFAULT_DEDUP_CONFIG.skipPatterns` included `*.json`, `*.yaml`, `*.yml`, `*.toml`, `*.ini`.

**Fix:** Removed those extensions from `skipPatterns`. Lock files and build outputs remain covered by `ALWAYS_SKIP_PATTERNS`.

**File:** `packages/reviewer/src/review/deduplication.ts`

---

### B — Generated files not skipped ✅

**Symptom:** LLM wasted tokens reviewing `.pb.ts`, `.gen.ts`, and `__generated__/` files.

**Root cause:** `ALWAYS_SKIP_PATTERNS` didn't include protobuf or GraphQL codegen patterns.

**Fix:** Added `/\.pb\.(js|ts|jsx|tsx)$/i`, `/_pb\.(js|ts|jsx|tsx)$/i`, `/\.generated\.(ts|js|tsx|jsx)$/i`, `/\.gen\.(ts|js|tsx|jsx)$/i`, `/__generated__\//`.

**File:** `packages/reviewer/src/review/deduplication.ts`

---

### C — `isCommentDismissed()` dismissed AgnusAI's own comments ✅

**Symptom:** AgnusAI comments containing words like "nit" or "fixed" in their body were marked as dismissed and never re-posted.

**Root cause:** `isCommentDismissed()` was checking the AgnusAI comment's own body for dismissal keywords instead of checking user reply comments.

**Fix:** Changed to `isCommentDismissed(comment, allComments)`. Now finds replies where `c.inReplyToId === comment.id` and checks those bodies.

**File:** `packages/reviewer/src/review/deduplication.ts`

---

### D — Weak hash caused deduplication collisions ✅

**Symptom:** Two different issues on the same line could be treated as duplicates if their first 50 body characters matched.

**Root cause:** 32-bit djb2 hash over only the first 50 characters of the body.

**Fix:** Replaced with `crypto.createHash('sha256')` over `path + line + full body`, taking the first 16 hex characters.

**File:** `packages/reviewer/src/review/deduplication.ts`

---

### E — LLM unaware when diff is truncated ✅

**Symptom:** On large PRs, the diff is silently cut at `maxDiffSize` characters. The LLM hallucinated comments about files it never saw.

**Root cause:** `buildDiffSummary` appended a `[Diff truncated]` note but never told the LLM to stay within bounds.

**Fix:** `buildDiffSummary` now returns `{ content, truncated, truncatedCount }`. When truncated, `buildReviewPrompt` injects a `⚠️ IMPORTANT` notice before the RULES section.

**File:** `packages/reviewer/src/llm/prompt.ts`

---

### F — `maxDiffSize` config ignored ✅

**Symptom:** User-configurable `review.maxDiffSize` in `config.yaml` had no effect; the hardcoded constant `30000` was always used.

**Root cause:** `MAX_DIFF_CHARS = 30000` was a module-level constant; `context.config.maxDiffSize` was never passed to `buildDiffSummary`.

**Fix:** Removed the constant. `buildDiffSummary(diff, maxChars)` now accepts `maxChars`. `buildReviewPrompt` passes `context.config.maxDiffSize ?? 30000`.

**File:** `packages/reviewer/src/llm/prompt.ts`

---

### G — Parser accepted invalid line numbers silently ✅

**Symptoms:**
1. `parseInt(line)` returning `NaN` or `0` produced bad inline comments
2. Missing `VERDICT:` silently defaulted to `'comment'` with no log
3. Truncated LLM responses were silently treated as valid

**Fix:**
- Skip comment and `console.warn` if `!isFinite(lineNum) || lineNum < 1`
- `console.warn` when `VERDICT:` is absent
- Detect truncated responses (has `[File:` but no `VERDICT:`) and warn

**File:** `packages/reviewer/src/llm/parser.ts`

---

### H — Malformed checkpoint JSON silently ignored ✅

**Symptom:** When checkpoint JSON is corrupted, the system fell back to a full review with no indication of why.

**Root cause:** `catch {}` in `parseCheckpoint` was empty.

**Fix:** `catch (error)` now logs `[AgnusAI] Malformed checkpoint JSON, falling back to full review. Snippet: "..."`.

**File:** `packages/reviewer/src/review/checkpoint.ts`

---

### I — Feedback links and comment persistence silently skipped ✅

**Symptom:** Review comments posted to GitHub had no 👍/👎 links. No `review_comments` rows were written to the database. The `GET /api/feedback` endpoint returned `Invalid token.` for valid-looking URLs.

**Root cause:** `docker-compose.yml` passes `FEEDBACK_SECRET=` (empty string) as the default. The fallback chain in both `review-runner.ts` and `feedback.ts` used `??` (nullish coalescing), which treats `''` as a defined value and short-circuits — never reaching `WEBHOOK_SECRET`. The result: `feedbackSecret` was `''` (falsy), so `if (baseUrl && feedbackSecret)` was always false (no links, no DB rows). The token verification in `feedback.ts` also used `''` — so even manually constructed URLs were rejected.

**Fix:** Changed `??` to `||` in both files so empty strings fall through to `WEBHOOK_SECRET` / `SESSION_SECRET`.

**Files:** `packages/api/src/review-runner.ts`, `packages/api/src/routes/feedback.ts`

---

## Open Gaps

### LLM Knowledge Cutoff — Package Versions

The LLM may claim a package version "doesn't exist" or "is outdated" based on stale training data. A `VERSION_CLAIM_PATTERNS` filter in `deduplication.ts` catches common phrasings, but novel phrasings can slip through. The prompt also contains an explicit rule not to comment on versions.

**Mitigation:** `VERSION_CLAIM_PATTERNS` regex list + prompt rule. Expand the pattern list as new phrasings appear.

---

### Local Model Format Drift

Local models (qwen2.5-coder, codellama) sometimes produce malformed `[File:, Line:]` markers or omit `VERDICT:`. Fix G adds warnings. The prompt includes a concrete comment example to guide the model.

**Mitigation:** Monitored via warnings. The parser has a fallback format for older bracket-style output.

---

### Azure DevOps Rate Limits

For PRs with many changed files, each file requires 2 API calls. This can hit rate limits on large PRs.

**Mitigation:** Sequential file fetching helps. No retry/backoff logic yet.

---

### Tree-sitter Go ABI Mismatch

`tree-sitter-go` ships with ABI 15, but `web-tree-sitter@0.24.x` only supports ABI up to 14. Go files are not indexed.

**Mitigation:** Go parser gracefully skipped with a warning on startup. Other parsers continue normally.

**Workaround:** Downgrade to `tree-sitter-go` version that ships ABI 14, or wait for `web-tree-sitter` 0.25+ which supports ABI 15.
