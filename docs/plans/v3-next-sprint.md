# v3 Next Sprint — Implementation Plan

> **Date:** March 2026
> **Covers:** All remaining Phase 1 items + all Phase 2 items from the v3 competitive roadmap.
> **What is NOT covered:** Phase 3 (test generation, CI analysis, doc generation) — those are large-effort items for a separate sprint.

---

## Current State Recap


| Done | Feature                                                                                 |
| ---- | --------------------------------------------------------------------------------------- |
| ✅    | Multi-org RBAC, per-org webhooks                                                        |
| ✅    | PR description generation (title, body, walkthrough, change type)                       |
| ✅    | Multi-agent specialist orchestration (6 agents + judge + summary)                       |
| ✅    | Rules enforcement system (CRUD, dashboard, prompt injection, analytics)                 |
| ✅    | Ticket adapters — Jira, Linear, Azure Boards, GitHub Issues                             |
| ✅    | PR label automation — labels generated and applied as part of PR description generation |
| 🔶   | Ticket compliance structured verdict — adapters done, verdict format not yet structured |


**Remaining Phase 1 gaps:**

- Inline suggestion validation with tree-sitter (G2)
- Ticket compliance structured verdict (G6 completion)

**All Phase 2 gaps:**

- Self-reflection second pass (G12)
- `/ask` command — interactive Q&A on a PR (G8)
- PR splitting detection (G10)
- Hierarchical `best_practices.md` config (G14)

---

## `Task 1 — Inline Suggestion Validation (tree-sitter syntax check)

**Roadmap ref:** G2 / Phase 1 item 4
**Effort:** Small (1–2 days)
**Impact:** Prevents LLM-generated `suggestion` blocks that introduce syntax errors from reaching the PR — eliminates the most common complaint about AI code review noise.

### What to build

After `parseReviewResponse()` returns comments, scan each `comment.suggestion` (content of ````suggestion` fences) through a tree-sitter parse of the **full patched file**. If the patched file has parse errors, drop the suggestion (keep the comment body, just remove the suggestion block).

### Files to change


| File                                                   | Change                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/reviewer/src/llm/parser.ts`                  | Extract ````suggestion ... ```` content from comment body; store in `comment.suggestion`. Already modeled in `ReviewComment.suggestion` but not parsed.                                                                                 |
| `packages/reviewer/src/review/suggestion-validator.ts` | **New file.** `validateSuggestions(comments, files, parser)` — for each comment with a suggestion, reconstruct the file with the patch applied, parse with web-tree-sitter, return comment with `suggestion` nulled out if parse fails. |
| `packages/reviewer/src/index.ts`                       | Call `validateSuggestions()` after `parseReviewResponse()` and before `filterByConfidence()` in the `review()` and `incrementalReview()` paths.                                                                                         |
| `packages/reviewer/src/types.ts`                       | No change needed — `ReviewComment.suggestion` already exists.                                                                                                                                                                           |


### Algorithm in `suggestion-validator.ts`

```typescript
export async function validateSuggestions(
  comments: ReviewComment[],
  files: FileInfo[],          // fetched from VCS — full file content
  parse: (code: string, language: string) => boolean,  // returns true if parse OK
): Promise<ReviewComment[]> {
  return Promise.all(comments.map(async comment => {
    if (!comment.suggestion) return comment;
    const file = files.find(f => f.path === comment.path);
    if (!file?.content || !file.language) return comment;

    const lines = file.content.split('\n');
    // Apply suggestion: replace line range with suggestion content
    const patched = applyLinePatch(lines, comment.line, comment.suggestion);
    const syntaxOk = parse(patched, file.language);
    if (!syntaxOk) {
      console.warn(`[suggestion-validator] Dropping syntactically invalid suggestion at ${comment.path}:${comment.line}`);
      return { ...comment, suggestion: undefined };
    }
    return comment;
  }));
}

function applyLinePatch(lines: string[], targetLine: number, suggestion: string): string {
  const idx = targetLine - 1;
  const patched = [...lines];
  patched.splice(idx, 1, ...suggestion.split('\n'));
  return patched.join('\n');
}
```

### Parser integration

Use the existing `packages/core/src/parser/` parsers. Expose a `isSyntaxValid(code: string, language: string): boolean` function from `@agnus-ai/core`.

Supported languages for validation: TypeScript, JavaScript, Python, Java, Go, C# (matches existing core parsers).
Unknown languages: skip validation, pass suggestion through unchanged.

### Acceptance criteria

- A suggestion that would produce a TS parse error is stripped from the comment body before posting.
- Comment body text (the description of the issue) is still posted — only the `suggestion` fence is removed.
- Validation errors are logged with file + line for debugging.
- If tree-sitter is unavailable, validation is skipped and suggestions pass through (graceful degradation).

---

## Task 2 — Ticket Compliance Structured Verdict

**Roadmap ref:** G6 / Phase 1 item 5
**Effort:** Small (1 day)
**Impact:** PMs and QA leads can scan the summary and immediately know compliance status — replaces freeform compliance comments with a machine-readable verdict.

### What to build

The `ticket_compliance` specialist agent currently produces freeform comments. Add a post-processing step that:

1. Reads all compliance findings from the `ticket_compliance` agent output.
2. Produces a structured verdict block appended to the review summary.
3. Posts it as a dedicated comment section, not inline.

### Verdict format

```markdown
## 📋 Ticket Compliance

| Ticket | Verdict | Gaps |
|--------|---------|------|
| ENG-1042: Add OAuth login | ✅ Fully Compliant | — |
| ENG-1043: Email notification on signup | 🔶 Partially Compliant | Missing unsubscribe link implementation |
| #88: Rate limit auth endpoint | ❌ Not Compliant | No rate limiting middleware found in diff |
```

### Files to change


| File                                          | Change                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/reviewer/src/review/multi-agent.ts` | Add `buildTicketComplianceVerdict(tickets, complianceComments): string` — maps ticket keys to verdict rows based on which compliance findings mention them. |
| `packages/reviewer/src/review/multi-agent.ts` | In `assembleSummary()`: if `tickets.length > 0`, append the compliance table below `### Summary`.                                                           |
| `packages/reviewer/src/llm/prompt.ts`         | Update `ticket_compliance` agent directive: require output to include `[Ticket: KEY]` marker per finding so verdict builder can correlate.                  |
| `packages/reviewer/src/types.ts`              | Add `complianceVerdict?: TicketComplianceVerdict[]` to `ConsolidatedReview`.                                                                                |


### Verdict logic

```typescript
type ComplianceStatus = 'compliant' | 'partial' | 'noncompliant';

function buildTicketComplianceVerdict(
  tickets: Ticket[],
  complianceComments: ReviewComment[],
): string {
  const rows = tickets.map(ticket => {
    // Match compliance comments that cite this ticket key
    const related = complianceComments.filter(c =>
      c.body.includes(ticket.key) || c.body.includes(ticket.title.slice(0, 30))
    );
    const status: ComplianceStatus = related.length === 0
      ? 'compliant'
      : related.some(c => c.severity === 'error') ? 'noncompliant' : 'partial';
    const statusEmoji = { compliant: '✅', partial: '🔶', noncompliant: '❌' }[status];
    const verdict = { compliant: 'Fully Compliant', partial: 'Partially Compliant', noncompliant: 'Not Compliant' }[status];
    const gaps = related.map(c => c.body.split('\n')[0].replace(/\*+/g, '').trim()).join('; ') || '—';
    return `| ${ticket.key}: ${ticket.title.slice(0, 40)} | ${statusEmoji} ${verdict} | ${gaps} |`;
  });

  return [
    '\n## 📋 Ticket Compliance\n',
    '| Ticket | Verdict | Gaps |',
    '|--------|---------|------|',
    ...rows,
  ].join('\n');
}
```

### Prompt directive update for `ticket_compliance` agent

Add to directive:

> For each ticket gap you find, start your comment with `[Ticket: KEY]` where KEY is the exact ticket key from `## Linked Tickets`. This allows structured verdict generation.

### Acceptance criteria

- When `TICKET_PROVIDER` is set and tickets are injected, the review summary contains a compliance table.
- Each ticket maps to exactly one verdict row.
- If no compliance issues are found for a ticket, it shows `✅ Fully Compliant`.
- If no tickets are linked, the compliance section is omitted.

---

## Task 3 — Self-Reflection Second Pass

**Roadmap ref:** G12 / Phase 2 item 7
**Effort:** Small (1 day)
**Impact:** Calibration — a separate LLM call re-scores each finding independently, catching cases where the model over-confidently scored its own output. Measurably reduces false-positive rate without needing more training.

### What to build

A second LLM call that receives the full list of draft comments (after dedup, before precision filter) and returns a re-ranked score for each. Comments that score below threshold after the second pass are dropped.

### Files to change


| File                                              | Change                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/reviewer/src/review/self-reflection.ts` | **New file.** `runSelfReflection(llm, context, comments): Promise<ReviewComment[]>`                                       |
| `packages/reviewer/src/review/multi-agent.ts`     | In `runReviewWithSpecialists()`: call `runSelfReflection()` after judge pass, before `filterByConfidence()`.              |
| `packages/reviewer/src/index.ts`                  | In `review()` single-agent path: call `runSelfReflection()` after `parseReviewResponse()`, before `filterByConfidence()`. |
| `packages/reviewer/src/types.ts`                  | Add `selfReflectionEnabled?: boolean` to `ReviewConfig`.                                                                  |
| `packages/api/src/review-runner.ts`               | Wire `SELF_REFLECTION_ENABLED=true` env var.                                                                              |


### Prompt design

```
You are reviewing AI-generated code review comments for quality.
For each numbered finding below, assign a score 0-10:
- 10: Definite bug, security issue, or clear correctness problem with concrete evidence from the diff.
- 7-9: Likely issue with clear impact, well-evidenced.
- 4-6: Potential issue, speculative or stylistic.
- 0-3: Noise — too vague, cannot be confirmed from the diff, or addresses a non-issue.

Respond ONLY in this format:
SCORES: 8, 3, 9, 2, 7   (one number per finding, comma-separated, same order as input)

Findings:
1. [auth.ts:42] <body>
2. [db.ts:88] <body>
...
```

### Algorithm

```typescript
export async function runSelfReflection(
  llm: LLMBackend,
  context: ReviewContext,
  comments: ReviewComment[],
  threshold = 5,
): Promise<ReviewComment[]> {
  if (comments.length === 0) return comments;
  const prompt = buildReflectionPrompt(comments);
  const raw = await llm.generate(prompt, context);
  const scores = parseScores(raw, comments.length);
  if (!scores) return comments; // graceful degradation

  return comments
    .map((c, i) => ({ ...c, confidence: (scores[i] ?? 0) / 10 }))
    .filter((c, i) => (scores[i] ?? 0) >= threshold);
}
```

### Env vars

```env
SELF_REFLECTION_ENABLED=true   # default: false
SELF_REFLECTION_THRESHOLD=5    # 0-10 score cutoff (default: 5)
```

### Acceptance criteria

- With `SELF_REFLECTION_ENABLED=true`, comment count decreases by 20–40% vs baseline on the same PR (noise reduction).
- Comments that survive self-reflection have higher average confidence.
- If the second LLM call fails, original comments pass through unchanged (graceful degradation).
- Not enabled by default — existing deployments are unaffected.

---

## Task 4 — `/ask` — Interactive Q&A on the PR

**Roadmap ref:** G8 / Phase 2 item 8
**Effort:** Medium (3–4 days)
**Impact:** Transforms AgnusAI from a one-shot reviewer to an interactive assistant. Reviewers can ask follow-up questions without switching context.

### What to build

When a comment on the PR starts with `/ask`  (GitHub) or `@agnus ask`  (Azure), the webhook triggers a focused LLM answer with full diff + graph context, posted as a reply to that comment thread.

### Flow

```
User posts comment: "/ask Why is this change safe with concurrent requests?"
        ↓
Webhook receives issue_comment (GitHub) or pullRequestCommentThread (Azure)
        ↓
Parse command: extract question from comment body
        ↓
Fetch PR diff + graph context (same as review — reuse existing pipeline)
        ↓
Build /ask prompt: question + diff + graph context (no review format, pure Q&A)
        ↓
LLM generates answer (freeform markdown)
        ↓
Post as reply to the same comment thread
```

### Files to change


| File                                                 | Change                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api/src/routes/webhooks.ts`                | Detect `/ask` command in `issue_comment.created` (GitHub) and comment thread events (Azure). Extract question, call `runAsk()`.                         |
| `packages/api/src/ask-runner.ts`                     | **New file.** `runAsk(opts: AskRunOptions): Promise<string>` — fetches diff, builds context, calls LLM, returns answer.                                 |
| `packages/reviewer/src/llm/prompt.ts`                | Add `buildAskPrompt(question: string, context: ReviewContext): string`.                                                                                 |
| `packages/reviewer/src/adapters/vcs/github.ts`       | Add `replyToComment(prNumber, commentId, body): Promise<void>` using `POST /repos/{owner}/{repo}/pulls/{prNumber}/comments/{commentId}/replies`.        |
| `packages/reviewer/src/adapters/vcs/azure-devops.ts` | Add `replyToThread(prNumber, threadId, body): Promise<void>` using `POST /_apis/git/repositories/{repo}/pullRequests/{pr}/threads/{threadId}/comments`. |


### `ask-runner.ts` structure

```typescript
export interface AskRunOptions {
  platform: 'github' | 'azure';
  repoId: string;
  repoUrl: string;
  prNumber: number;
  question: string;
  commentId: number;           // thread/comment to reply to
  token?: string;
  baseBranch: string;
  pool: Pool;
}

export async function runAsk(opts: AskRunOptions): Promise<void> {
  // 1. Build VCS adapter (same as review-runner)
  // 2. Fetch diff + graph context (reuse getReviewContext)
  // 3. Build minimal ReviewContext (no tickets, no skills needed)
  // 4. buildAskPrompt(opts.question, context) → send to LLM
  // 5. vcs.replyToComment(prNumber, commentId, answer)
}
```

### Ask prompt structure

```
You are an expert code reviewer answering a question about a pull request.
Answer the question below using the diff and codebase context provided.
Be concise, accurate, and reference specific file paths and line numbers from the diff where relevant.

## Question
{question}

## PR
Title: {pr.title}
Branch: {pr.sourceBranch} → {pr.targetBranch}

## Diff
{diffContent}

{graphSection}

Answer the question directly. Do not repeat the question. Use markdown.
```

### GitHub webhook trigger detection

```typescript
// In webhookRoutes — GitHub issue_comment.created handler
const body = payload.comment?.body?.trim() ?? '';
if (body.startsWith('/ask ') && payload.issue?.pull_request) {
  const question = body.slice('/ask '.length).trim();
  const prNumber = payload.issue.number;
  const commentId = payload.comment.id;
  // fire-and-forget with logging
  runAsk({ ..., question, commentId, prNumber }).catch(err =>
    console.error('[ask-runner] Error:', err)
  );
  return reply.status(202).send({ status: 'ask accepted' });
}
```

### Env vars

```env
ASK_ENABLED=true    # default: true — disable if you want to suppress interactive commands
```

### Rate limiting

Reuse the existing webhook rate limiter. Add a per-PR rate limit of 10 `/ask` calls per hour to prevent abuse (stored in an in-memory `Map<prKey, CallRecord>`).

### Acceptance criteria

- Posting `/ask Why does this change affect the auth middleware?` on a GitHub PR triggers a reply in ≤30s.
- Reply is posted in the same thread as the question.
- If graph context is available, the answer references callers/callees from the blast radius.
- `/ask` on an unregistered repo (no repoId match) is silently ignored.
- `ASK_ENABLED=false` disables the command without disabling other webhook processing.

---

## Task 5 — PR Splitting Detection

**Roadmap ref:** G10 / Phase 2 item 9
**Effort:** Small (1 day)
**Impact:** Keeps PRs focused. A PR touching 4 unrelated subsystems is hard to review; flagging it saves the team from merged complexity debt.

### What to build

Detect PRs that touch too many unrelated concerns and post a structured splitting recommendation in the summary. This is a post-processing analysis on the diff — no extra LLM call for small PRs.

### Splitting heuristics (deterministic first pass)

A PR is a "split candidate" if **any two of these** are true:

- `diff.changedFiles > 15`
- Changed files span 3+ unrelated top-level directories (e.g. `src/auth/`, `src/billing/`, `migrations/`)
- Diff includes both test files and migration files
- `diff.additions + diff.deletions > 800`

If the deterministic check triggers, run an LLM split analysis call.

### Files to change


| File                                             | Change                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `packages/reviewer/src/review/split-detector.ts` | **New file.** `detectSplit(diff, context): Promise<SplitDetectionResult                              |
| `packages/reviewer/src/review/multi-agent.ts`    | In `assembleSummary()`: if `splitResult` exists, append `### ⚠️ Consider Splitting This PR` section. |
| `packages/reviewer/src/index.ts`                 | In `postReview()`: run `detectSplit()` and attach result to `ReviewResult`.                          |
| `packages/reviewer/src/types.ts`                 | Add `splitSuggestion?: SplitSuggestion` to `ReviewResult`.                                           |


### `split-detector.ts` structure

```typescript
export interface SplitSuggestion {
  shouldSplit: boolean;
  reason: string;
  suggestedSplits: Array<{ name: string; files: string[] }>;
}

export async function detectSplit(
  diff: Diff,
  context: ReviewContext,
): Promise<SplitSuggestion | null> {
  if (!isSplitCandidate(diff)) return null;
  return runSplitLLM(diff, context);
}

function isSplitCandidate(diff: Diff): boolean {
  const dirs = new Set(diff.files.map(f => f.path.split('/')[0]));
  const hasMigrations = diff.files.some(f => f.path.includes('migration'));
  const hasTests = diff.files.some(f => f.path.match(/\.(test|spec)\./));
  const conditions = [
    diff.changedFiles > 15,
    dirs.size >= 3,
    hasMigrations && hasTests,
    diff.additions + diff.deletions > 800,
  ];
  return conditions.filter(Boolean).length >= 2;
}
```

### LLM split prompt

```
This PR touches the following files:
{fileList}

The PR title is: {pr.title}

Determine if this PR should be split into smaller, focused PRs.
If yes, name each suggested sub-PR and list its files.

Respond ONLY in this format:
SHOULD_SPLIT: yes|no
REASON: <one sentence>
SPLIT_1: <name> | <comma-separated file paths>
SPLIT_2: <name> | <comma-separated file paths>
...
```

### Output appended to summary

```markdown
### ⚠️ Consider Splitting This PR

This PR touches 4 unrelated areas and may be difficult to review thoroughly.

**Suggested splits:**
- **`feat/auth-middleware`** — `src/auth/`, `src/middleware/`
- **`feat/billing-update`** — `src/billing/`, `migrations/`
- **`chore/test-cleanup`** — `tests/`, `*.spec.ts`
```

### Env vars

```env
SPLIT_DETECTION_ENABLED=true   # default: true
SPLIT_FILE_THRESHOLD=15        # default: 15
```

### Acceptance criteria

- A PR with 20 files across 4 directories generates a split suggestion in the summary.
- A PR with 5 files in one directory produces no split suggestion.
- `SPLIT_DETECTION_ENABLED=false` skips the check entirely.
- The LLM call is only triggered if the deterministic heuristics fire — no extra latency on small PRs.

---

## Task 6 — Hierarchical `best_practices.md` Config

**Roadmap ref:** G14 / Phase 2 item 10
**Effort:** Medium (2–3 days)
**Impact:** Gives teams the ability to define review guidelines in plain markdown files in the repo itself — org-wide defaults that repo teams can extend, monorepo paths can specialize. The natural complement to the rules system for human-authored guidance.

### What to build

A config resolution system that merges `.agnus/best_practices.md` files from four scopes (lowest wins):

```
Global (org default)
  └─ Repo root (.agnus/best_practices.md)
       └─ Package/subdir (.agnus/packages/api/best_practices.md)
            └─ Path override (.agnus/src/payments/best_practices.md)
```

Content from matching files is concatenated and injected into the review prompt as a `## Team Best Practices` section.

### Config file format

Plain markdown with optional frontmatter:

```markdown
---
scope: repo                         # org | repo | path
paths:                              # only for scope: path
  - src/payments/**
  - src/billing/**
priority: high                      # low | medium | high
---

## Code Style

- Use `Result<T, E>` instead of throwing for expected errors.
- All public API endpoints must have input validation via Zod.

## Security

- Never log request bodies — they may contain PII.
- OAuth tokens must be stored in httpOnly cookies, not localStorage.
```

### Resolution algorithm

At review time, given `changedFiles`:

1. Fetch `.agnus/best_practices.md` from repo root (VCS adapter call).
2. Collect unique top-level directories from `changedFiles`.
3. For each dir, attempt to fetch `.agnus/{dir}/best_practices.md`.
4. Parse frontmatter from each file; filter by `paths` glob if present.
5. Sort by `priority` (high > medium > low), deduplicate overlapping content by section heading.
6. Inject merged content into prompt as `## Team Best Practices`.

### Files to change


| File                                                    | Change                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/reviewer/src/review/best-practices-loader.ts` | **New file.** `loadBestPractices(vcs, diff, prNumber): Promise<string>`                                     |
| `packages/reviewer/src/adapters/vcs/base.ts`            | Add `getFileContent(prNumber: number, filePath: string): Promise<string | null>` to VCS interface.          |
| `packages/reviewer/src/adapters/vcs/github.ts`          | Implement `getFileContent` using `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`.                  |
| `packages/reviewer/src/adapters/vcs/azure-devops.ts`    | Implement `getFileContent` using `GET /_apis/git/repositories/{repo}/items?path={path}&version={branch}`.   |
| `packages/reviewer/src/index.ts`                        | In `review()`, call `loadBestPractices()` and pass result into `ReviewContext` as `bestPractices?: string`. |
| `packages/reviewer/src/llm/prompt.ts`                   | Add `bestPracticesSection` between `## Team Best Practices` and `## Review Skills Applied`.                 |
| `packages/reviewer/src/types.ts`                        | Add `bestPractices?: string` to `ReviewContext`.                                                            |


### `best-practices-loader.ts` structure

```typescript
export async function loadBestPractices(
  vcs: VCSAdapter,
  diff: Diff,
  branch: string,
): Promise<string> {
  const candidates: string[] = ['.agnus/best_practices.md'];

  // Add per-directory candidates based on changed files
  const dirs = new Set(diff.files.map(f => f.path.split('/')[0]).filter(Boolean));
  for (const dir of dirs) {
    candidates.push(`.agnus/${dir}/best_practices.md`);
  }

  const sections: string[] = [];
  for (const candidate of candidates) {
    const content = await vcs.getFileContent(0, candidate).catch(() => null);
    if (!content) continue;
    const { body } = parseFrontmatter(content);
    if (body.trim()) sections.push(body.trim());
  }

  return sections.join('\n\n---\n\n');
}
```

### Prompt injection (in `buildReviewPrompt`)

```typescript
const bestPracticesSection = context.bestPractices
  ? `\n## Team Best Practices\nApply these team-specific guidelines when reviewing this PR:\n\n${context.bestPractices}\n`
  : '';
```

Insert between `## Review Skills Applied` and `## Examples`.

### Dashboard surface

Add a "Best Practices" tab in the repository settings page (`RepoDetails.tsx`) showing:

- Which `.agnus/best_practices.md` files were loaded for the last review.
- File content preview.
- Link to edit in VCS.

This is read-only — editing is done in the repo itself.

### Env vars

```env
BEST_PRACTICES_ENABLED=true    # default: true
BEST_PRACTICES_MAX_CHARS=3000  # truncate if too large (default: 3000)
```

### Acceptance criteria

- A repo with `.agnus/best_practices.md` at root — its content appears in every review prompt.
- A monorepo with `.agnus/packages/api/best_practices.md` — API-specific practices appear only when API files are in the diff.
- Missing files are silently skipped, no review failure.
- Org-level default practices can be stored in the database and fetched without a VCS call (future extension point — DB table `org_best_practices`).

---

## Build Order

Execute in this sequence to minimize integration risk:


| #   | Task                                 | Depends On           | Branch                           |
| --- | ------------------------------------ | -------------------- | -------------------------------- |
| 1   | Inline suggestion validation         | —                    | `feat/suggestion-validation`     |
| 2   | Ticket compliance structured verdict | —                    | `feat/ticket-compliance-verdict` |
| 3   | Self-reflection second pass          | —                    | `feat/self-reflection`           |
| 4   | PR splitting detection               | —                    | `feat/split-detection`           |
| 5   | Hierarchical best_practices          | VCS `getFileContent` | `feat/best-practices`            |
| 6   | `/ask` command                       | VCS `replyToComment` | `feat/ask-command`               |


Tasks 1–4 are independent and can be developed in parallel. Tasks 5 and 6 both require `getFileContent` and `replyToComment` additions to the VCS interface — do those first if parallelising.

---

## What This Sprint Completes

After all 6 tasks:


| Phase   | Item                         | Status |
| ------- | ---------------------------- | ------ |
| Phase 1 | Multi-org                    | ✅      |
| Phase 1 | PR description               | ✅      |
| Phase 1 | PR labels                    | ✅      |
| Phase 1 | Inline suggestion validation | ✅      |
| Phase 1 | Ticket compliance verdict    | ✅      |
| Phase 2 | Rules system                 | ✅      |
| Phase 2 | Self-reflection              | ✅      |
| Phase 2 | `/ask` command               | ✅      |
| Phase 2 | PR splitting                 | ✅      |
| Phase 2 | `best_practices.md`          | ✅      |


**Phase 3 (test generation, CI failure analysis, auto best practices distillation, doc generation) remains for a follow-on sprint.**