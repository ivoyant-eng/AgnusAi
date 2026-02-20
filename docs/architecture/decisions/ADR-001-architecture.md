# ADR-001: AgnusAI — PR Review Agent Architecture

## Status
**Implemented** ✅ (Phase 1 & 2 complete)

---

## Context

We built an AI-powered PR review agent that:
- Reviews pull requests on **GitHub** and **Azure DevOps**
- Posts **rich inline comments** on specific diff lines with severity, steps of reproduction, and AI fix prompts
- Uses **Vercel AI SDK** with unified backend supporting Ollama, OpenAI, Azure OpenAI, and any OpenAI-compatible endpoint
- Runs via CLI or in CI/CD pipelines — no continuously running service

### Constraints
- Must work locally with no external LLM API required (Ollama)
- Support multiple VCS platforms without duplicating review logic
- Prompt building and response parsing must be shared across all LLM providers
- Token budget: ~30K characters for diff content
- Azure DevOps does not expose a unified diff endpoint — diffs must be computed from file content

---

## Architecture

### High-Level Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    CI/CD Pipeline or CLI                         │
│          (GitHub Actions / Azure Pipelines / Terminal)          │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                        PRReviewAgent                             │
│                         src/index.ts                             │
│                                                                  │
│  1. Fetches PR metadata, diff, and files from VCS               │
│  2. Matches applicable skills by file glob patterns             │
│  3. Builds ReviewContext and calls LLM.generateReview()         │
│  4. Validates comment paths against actual diff file list       │
│  5. Posts comments via VCS adapter                              │
└──────────────────────────────────────────────────────────────────┘
          │                    │                       │
          ▼                    ▼                       ▼
┌──────────────────┐  ┌─────────────────────┐  ┌──────────────────┐
│   VCS Adapters   │  │    LLM Backends      │  │  Skill Loader    │
│  src/adapters/   │  │    src/llm/          │  │  src/skills/     │
│                  │  │                      │  │                  │
│  GitHubAdapter   │  │  BaseLLMBackend      │  │  Reads SKILL.md  │
│  AzureDevOps     │  │  (abstract)          │  │  files, matches  │
│  Adapter         │  │  ┌────────────────┐  │  │  by glob pattern │
│                  │  │  │  prompt.ts     │  │  │  against changed │
│  Responsibilities│  │  │  (shared)      │  │  │  files           │
│  - getPR()       │  │  └────────────────┘  │  └──────────────────┘
│  - getDiff()     │  │  ┌────────────────┐  │
│  - getFiles()    │  │  │  parser.ts     │  │
│  - addInline     │  │  │  (shared)      │  │
│    Comment()     │  │  └────────────────┘  │
│  - submitReview()│  │                      │
│                  │  │  ┌──────┐ ┌───────┐  │
│  Azure specifics:│  │  ┌────────────────────┐
│  - LCS diff from │  │  │ Unified Backend    │
│    file content  │  │  │ (Vercel AI SDK)    │
│  - Path leading  │  │  │ - Ollama           │
│    slash norm.   │  │  │ - OpenAI           │
└──────────────────┘  │  │ - Azure OpenAI     │
                      │  │ - Custom endpoint  │
                      └─────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                         Output Layer                             │
│                                                                  │
│  Inline comments (per file + line):                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ **Suggestion:** [description] [tag]                        │ │
│  │ <details> Severity Level: Major ⚠️ </details>             │ │
│  │ ```suggestion ... ```                                      │ │
│  │ **Steps of Reproduction:**                                 │ │
│  │ <details> Steps... </details>                             │ │
│  │ <details> Prompt for AI Agent 🤖 </details>               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  General summary comment + verdict (approve/request_changes)    │
│  Azure DevOps: sets reviewer vote                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. VCS Adapters (`src/adapters/vcs/`)

Abstract interface implemented by each platform:

```typescript
interface VCSAdapter {
  getPR(prId: string | number): Promise<PullRequest>;
  getDiff(prId: string | number): Promise<Diff>;
  getFiles(prId: string | number): Promise<FileInfo[]>;
  addInlineComment(prId, path, line, body, severity): Promise<void>;
  submitReview(prId: string | number, review: Review): Promise<void>;
  getLinkedTickets(prId: string | number): Promise<Ticket[]>;
  getFileContent(path: string, ref?: string): Promise<string>;
}
```

**GitHub** (`github.ts`): Uses `@octokit/rest`. Returns unified diffs directly from the GitHub API.

**Azure DevOps** (`azure-devops.ts`):
- Fetches PR iterations to get `sourceRefCommit` and `commonRefCommit` (merge base)
- For each changed file, fetches content at both commits using the `/items` API
- Computes a real unified diff using an LCS algorithm (O(m×n), capped at 600k pairs)
- Generates `DiffHunk[]` with proper `@@ -old,n +new,n @@` headers
- Normalises `filePath` to always include a leading `/` in thread context (Azure DevOps requirement)

### 2. LLM Backends (`src/llm/`)

All providers extend `BaseLLMBackend` and only implement `generate()`:

```typescript
abstract class BaseLLMBackend {
  abstract readonly name: string;
  abstract generate(prompt: string, context: ReviewContext): Promise<string>;

  // Shared — same for all providers
  async generateReview(context: ReviewContext): Promise<ReviewResult> {
    const prompt = buildReviewPrompt(context);   // prompt.ts
    const response = await this.generate(prompt, context);
    return parseReviewResponse(response);        // parser.ts
  }
}
```

#### `prompt.ts` — Shared Prompt Builder

Builds the full review prompt including:
- PR metadata (title, author, branches, description)
- File list with status and line counts
- Unified diff (truncated at 30k characters)
- Applicable skill content
- Output format instructions with a concrete example comment showing the exact markdown structure expected

#### `parser.ts` — Shared Response Parser

Parses the LLM response by extracting `[File: /path, Line: N]` markers and treating everything after each marker (until the next marker or `VERDICT:`) as the pre-formatted markdown comment body.

Falls back to legacy `[File: path, Line: number]` bracket format if no markers are found.

### 3. Skill Loader (`src/skills/loader.ts`)

Reads `SKILL.md` files from `~/.pr-review/skills/`, parses YAML front matter, and matches skills to changed files using glob patterns. Matched skill content is injected directly into the LLM prompt.

### 4. PRReviewAgent (`src/index.ts`)

Orchestrates the full review flow:

```
review(prId):
  1. getPR() + getDiff() + getFiles()   → parallel API calls
  2. getLinkedTickets()                 → ticket context (Phase 3)
  3. skills.matchSkills(filePaths)      → applicable skills
  4. llm.generateReview(context)        → ReviewResult
  5. cache diff for postReview()

postReview(prId, result):
  1. Build diffPathMap (normalised path → original path)
  2. For each comment: validate path exists in diff
  3. vcs.submitReview()                 → posts inline comments + summary
```

---

## Data Flow

```
PR opened / updated
        │
        ▼
1. Fetch PR Data                    GitHub / Azure DevOps API
   - PR metadata (title, branches)
   - Diff (computed via LCS for Azure)
   - Changed file list
        │
        ▼
2. Build Context
   - Filter ignored paths
   - Match skills to file types
   - Optional: enrich with file contents
        │
        ▼
3. Generate Review                   Unified LLM Backend (Vercel AI SDK)
   - buildReviewPrompt(context)      → prompt.ts (shared)
   - provider.generate(prompt)       → API call
   - parseReviewResponse(response)   → parser.ts (shared)
        │
        ▼
4. Validate Comments
   - Normalise paths (strip leading /)
   - Match against actual diff file list
   - Skip comments on files not in diff
        │
        ▼
5. Post Review                       GitHub / Azure DevOps API
   - Inline comment per file+line
   - General summary comment
   - Verdict / vote
```

---

## Key Design Decisions

### Decision 1: Unified Backend with Vercel AI SDK

**Problem:** Initially had three separate LLM backends (Ollama, Claude, OpenAI) duplicating `buildReviewPrompt`, `buildDiffSummary`, and `parseReviewResponse` — ~400 lines of duplicated code. Adding new providers meant implementing from scratch.

**Decision:** Refactored to use Vercel AI SDK's `@ai-sdk/openai-compatible` package. Single `UnifiedLLMBackend` supports any OpenAI-compatible endpoint via `baseURL` + `apiKey` configuration.

**Result:** Adding a new provider requires only a config entry. Works with Ollama (local), OpenAI, Azure OpenAI, LM Studio, vLLM, and any custom endpoint.

### Decision 2: Azure DevOps LCS Diff

**Problem:** The Azure DevOps API's `/iterations/{id}/changes` endpoint returns file change metadata (added/deleted counts) but not actual diff content. The agent had no real code to review.

**Decision:** Fetch file content at `sourceRefCommit` and `commonRefCommit` (merge base) for each changed file, then compute a unified diff using Myers/LCS algorithm.

**Trade-offs:**
- Extra API calls per file (2 per changed file)
- LCS is O(m×n) — capped at 600k line pairs, falls back to full-replacement diff for very large files
- Result: real `+`/`-` line diffs that the LLM can meaningfully analyse

### Decision 3: LLM Generates Full Markdown Body

**Problem:** Early versions built the comment template from structured fields (severity, impacts, steps) extracted from the LLM response. Local models (qwen3.5) didn't reliably follow the structured `COMMENT_START/COMMENT_END` format.

**Decision:** Show the LLM a concrete example of the full rendered markdown comment in the prompt. The LLM writes the entire body. The parser only extracts `[File: path, Line: N]` for positioning.

**Result:** More natural output, fewer parsing failures, easier to customise format by changing the prompt example.

### Decision 4: Path Normalisation

**Problem:** Azure DevOps stores file paths with a leading `/` (e.g., `/src/foo.ts`). The LLM may omit it. Thread context `filePath` must match exactly, or Azure DevOps reports "file not found in PR".

**Decision:** In `postReview`, build a `Map<normalisedPath, originalPath>` from the diff. Each comment's path is looked up after stripping the leading `/`. Comments with no matching path are skipped with a warning.

### Decision 5: Pipeline-Triggered Model

**Decision:** The agent runs as a single-shot CLI process triggered by CI/CD or manually — not a long-running server.

**Benefits:** No idle costs, no state management, no long-lived tokens, scales automatically with CI runners.

---

## Comment Format

Each inline comment follows this structure:

```markdown
**Suggestion:** [one-sentence description of the issue] [tag]

<details>
<summary><b>Severity Level:</b> Major ⚠️</summary>

```mdx
- ⚠️ First concrete consequence
- ⚠️ Second concrete consequence
```
</details>

```suggestion
corrected_code_here()
```

**Steps of Reproduction:**

<details>
<summary><b>Steps of Reproduction ✅</b></summary>

```mdx
1. Step one
2. Step two
```
</details>

<details>
<summary><b>Prompt for AI Agent 🤖</b></summary>

```mdx
This is a comment left during a code review.
**Path:** /src/file.py
**Line:** 42
**Comment:** ...
Validate the correctness of the flagged issue. If correct, how can I resolve this?
```
</details>
```

---

## Implementation Status

### ✅ Phase 1 — Foundation
- [x] Skills folder structure and loader
- [x] GitHub adapter (getPR, getDiff, inline comments)
- [x] Ollama backend
- [x] CLI skeleton (`review`, `skills`, `config` commands)
- [x] Context builder
- [x] Inline comments on specific diff lines

### ✅ Phase 2 — Multi-provider + Azure
- [x] **Unified LLM Backend (Vercel AI SDK)** — replaces separate Ollama/Claude/OpenAI implementations
- [x] Azure DevOps adapter with LCS-based real diff
- [x] Decoupled `prompt.ts` / `parser.ts` shared across all providers
- [x] Rich inline comment format (Severity, Steps of Reproduction, AI Fix Prompt)
- [x] Path normalisation and validation before posting
- [x] Duplicate comment fix (single post path)
- [x] Fallback to COMMENT when REQUEST_CHANGES fails on own PR

### 🔲 Phase 3 — Ticket Integration
- [ ] Jira adapter
- [ ] Linear adapter
- [ ] GitHub Issues adapter
- [ ] Azure Boards adapter
- [ ] Memory system (learned codebase conventions)

### 🔲 Phase 4 — Distribution
- [ ] Binary distribution (pkg / bun)
- [ ] npm global install (`npm install -g agnus-ai`)
- [ ] Homebrew formula
- [ ] Self-review the reviewer (dogfooding)

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript / Node.js ≥ 18 |
| CLI Framework | `commander` |
| GitHub API | `@octokit/rest` |
| Azure DevOps API | `node-fetch` (REST) |
| HTTP Client | `node-fetch` |
| Config | `js-yaml` |
| LLM — Local | Ollama via Vercel AI SDK |
| LLM — Cloud | OpenAI, Azure OpenAI via Vercel AI SDK |
| Diff Algorithm | Myers LCS (custom implementation) |

## Consequences

### Positive
- Consistent review quality across all PRs
- Catches common issues before human review
- Provider-agnostic: swap LLM without touching prompts or parsing
- Works fully offline with Ollama
- Rich, actionable comment format with AI fix prompts

### Negative
- Local model (qwen3.5) may not follow output format as reliably as cloud models
- Azure DevOps diff requires N×2 API calls for N changed files
- Token limits cap diff size at ~30k characters

### Risks
- LLM hallucinating file paths (mitigated: path validation against actual diff)
- LLM output format drift (mitigated: concrete example in prompt, fallback parser)
- Azure DevOps API rate limits (mitigated: sequential file fetching)
