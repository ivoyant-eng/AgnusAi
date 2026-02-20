# Known Issues and LLM Blindspots

This document tracks all identified blindspots that cause false positives (hallucinated comments) or false negatives (real issues silently skipped). Each entry has a status.

---

## Blindspot A — Config/data files silently skipped

**Symptom:** `package.json`, `tsconfig.json`, GitHub Actions YAMLs receive no comments even when meaningfully changed.

**Root cause:** `DEFAULT_DEDUP_CONFIG.skipPatterns` included `*.json`, `*.yaml`, `*.yml`, `*.toml`, `*.ini`.

**Fix:** Removed those extensions from `skipPatterns`. Lock files and build outputs remain covered by `ALWAYS_SKIP_PATTERNS`.

**Status:** ✅ Fixed in `src/review/deduplication.ts`

---

## Blindspot B — Protocol Buffer / GraphQL codegen files not skipped

**Symptom:** LLM wastes tokens reviewing machine-generated `.pb.ts`, `.gen.ts`, and `__generated__/` files.

**Root cause:** `ALWAYS_SKIP_PATTERNS` didn't include protobuf or GraphQL codegen patterns.

**Fix:** Added `/\.pb\.(js|ts|jsx|tsx)$/i`, `/_pb\.(js|ts|jsx|tsx)$/i`, `/\.generated\.(ts|js|tsx|jsx)$/i`, `/\.gen\.(ts|js|tsx|jsx)$/i`, `/__generated__\//`.

**Status:** ✅ Fixed in `src/review/deduplication.ts`

---

## Blindspot C — `isCommentDismissed()` self-dismissed AgnusAI comments

**Symptom:** AgnusAI comments containing words like "nit" or "fixed" in their own body were incorrectly marked as dismissed and never re-posted.

**Root cause:** `isCommentDismissed()` was checking the AgnusAI comment's own body for dismissal keywords instead of checking user reply comments.

**Fix:** Changed signature to `isCommentDismissed(comment, allComments)`. Now finds replies where `c.inReplyToId === comment.id` and checks those bodies.

**Status:** ✅ Fixed in `src/review/deduplication.ts`

---

## Blindspot D — Weak hash in `generateIssueId()` caused collisions

**Symptom:** Two different issues on the same line in the same file could be incorrectly treated as duplicates if their first 50 body characters matched.

**Root cause:** 32-bit djb2 hash over only the first 50 characters of the body.

**Fix:** Replaced with `crypto.createHash('sha256')` over `path + line + full body`, taking first 16 hex characters.

**Status:** ✅ Fixed in `src/review/deduplication.ts`

---

## Blindspot E — LLM unaware when diff is truncated

**Symptom:** On large PRs, the diff is silently cut at `maxDiffSize` characters. The LLM hallucinates comments about files it never saw.

**Root cause:** `buildDiffSummary` appended a `[Diff truncated]` note to the diff content but never surfaced this to the LLM prompt in a way that instructed it to stay within bounds.

**Fix:** `buildDiffSummary` now returns `{ content, truncated, truncatedCount }`. When truncated, `buildReviewPrompt` injects a `⚠️ IMPORTANT` notice before the RULES section explicitly telling the LLM not to reference unseen files.

**Status:** ✅ Fixed in `src/llm/prompt.ts`

---

## Blindspot F — `maxDiffSize` config ignored

**Symptom:** User-configurable `review.maxDiffSize` in `config.yaml` had no effect; the hardcoded constant `30000` was always used.

**Root cause:** `MAX_DIFF_CHARS = 30000` was a module-level constant; `context.config.maxDiffSize` was never passed to `buildDiffSummary`.

**Fix:** Removed the constant. `buildDiffSummary(diff, maxChars)` now accepts `maxChars` as a parameter. `buildReviewPrompt` passes `context.config.maxDiffSize ?? 30000`.

**Status:** ✅ Fixed in `src/llm/prompt.ts`

---

## Blindspot G — Parser silently accepted invalid line numbers and missing VERDICT

**Symptoms:**
1. `parseInt(line)` returning `NaN` or `0` produced bad inline comments
2. Missing `VERDICT:` silently defaulted to `'comment'` with no log
3. Truncated LLM responses (cut off mid-comment) were silently treated as valid

**Fix:**
- Skip comment and `console.warn` if `!isFinite(lineNum) || lineNum < 1`
- `console.warn('[AgnusAI] No VERDICT in LLM response, defaulting to comment')` when VERDICT is absent
- Detect truncated responses: has `[File:` but no `VERDICT:` → warn that response appears cut off

**Status:** ✅ Fixed in `src/llm/parser.ts`

---

## Blindspot H — Malformed checkpoint JSON silently ignored

**Symptom:** When checkpoint JSON is corrupted (e.g. truncated PR comment), the system falls back to a full review with no indication of why.

**Root cause:** `catch {}` in `parseCheckpoint` was empty.

**Fix:** `catch (error: any)` now logs `[AgnusAI] Malformed checkpoint JSON, falling back to full review. Snippet: "..."`.

**Status:** ✅ Fixed in `src/review/checkpoint.ts`

---

## Open Gaps (Not Yet Fixed)

### LLM Knowledge Cutoff — Package Versions

The LLM may claim a package version "doesn't exist" or "is outdated" based on stale training data. A `VERSION_CLAIM_PATTERNS` filter in `deduplication.ts` catches common phrasings, but novel phrasing can slip through. The prompt also contains an explicit rule not to comment on versions.

**Mitigation:** `VERSION_CLAIM_PATTERNS` regex list + prompt rule.

**Status:** Partially mitigated. Pattern list should be expanded as new phrasings are observed.

### Local Model Format Drift

Local models (qwen3.5, codellama) sometimes produce malformed `[File:, Line:]` markers or omit `VERDICT:`. Fix G adds warnings for these cases. The comment format prompt includes a concrete example to guide the model.

**Status:** Monitored via warnings. No auto-correction.

### Azure DevOps Rate Limits

For PRs with many changed files, each file requires 2 API calls to fetch content at source and target commits. This can hit rate limits on large PRs.

**Status:** Open. Sequential fetching helps but no retry/backoff logic yet.
