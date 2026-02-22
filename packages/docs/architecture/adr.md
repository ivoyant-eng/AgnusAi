# ADR-001: PR Review Agent Architecture

**Status:** Implemented ✅ (Layer 0 — the foundation of the v2 monorepo)

---

## Context

AgnusAI is an AI-powered PR review agent that:
- Reviews pull requests on **GitHub** and **Azure DevOps**
- Posts **rich inline comments** on specific diff lines with severity, steps of reproduction, and AI fix prompts
- Uses **Vercel AI SDK** with a unified backend supporting Ollama, OpenAI, Azure OpenAI, and any OpenAI-compatible endpoint
- Runs via CLI or CI/CD pipeline — no continuously running service (in Layer 0)

### Constraints
- Must work locally with no external LLM API required (Ollama)
- Support multiple VCS platforms without duplicating review logic
- Prompt building and response parsing must be shared across all LLM providers
- Token budget: ~30K characters for diff content
- Azure DevOps has no unified diff endpoint — diffs must be computed from file content

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    CI/CD Pipeline or CLI                         │
│          (GitHub Actions / Azure Pipelines / Terminal)          │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                        PRReviewAgent                             │
│                   packages/reviewer/src/index.ts                 │
│                                                                  │
│  1. Fetch PR metadata, diff, and files from VCS                 │
│  2. Match applicable skills by file glob patterns               │
│  3. Build ReviewContext → call LLM.generateReview()             │
│  4. Validate comment paths against actual diff file list        │
│  5. Post comments via VCS adapter                               │
└──────────────────────────────────────────────────────────────────┘
          │                    │                       │
          ▼                    ▼                       ▼
┌──────────────────┐  ┌─────────────────────┐  ┌──────────────────┐
│   VCS Adapters   │  │    LLM Backends      │  │  Skill Loader    │
│  src/adapters/   │  │    src/llm/          │  │  src/skills/     │
│                  │  │                      │  │                  │
│  GitHubAdapter   │  │  BaseLLMBackend      │  │  Reads SKILL.md  │
│  AzureDevOps     │  │  (abstract)          │  │  files, matches  │
│  Adapter         │  │                      │  │  by glob pattern │
└──────────────────┘  │  ┌────────────────┐  │  └──────────────────┘
                      │  │  prompt.ts     │  │
                      │  │  (shared)      │  │
                      │  └────────────────┘  │
                      │  ┌────────────────┐  │
                      │  │  parser.ts     │  │
                      │  │  (shared)      │  │
                      │  └────────────────┘  │
                      │                      │
                      │  Unified Backend      │
                      │  (Vercel AI SDK)      │
                      │  - Ollama             │
                      │  - OpenAI             │
                      │  - Azure OpenAI       │
                      │  - Custom endpoint    │
                      └──────────────────────┘
```

---

## Key Design Decisions

### Decision 1: Unified Backend with Vercel AI SDK

**Problem:** Initially had three separate LLM backends (Ollama, Claude, OpenAI) duplicating `buildReviewPrompt`, `buildDiffSummary`, and `parseReviewResponse` — ~400 lines of duplicated code.

**Decision:** Use Vercel AI SDK's `@ai-sdk/openai-compatible`. Single `UnifiedLLMBackend` supports any OpenAI-compatible endpoint via `baseURL` + `apiKey`.

**Result:** Adding a new provider requires only a config entry. Works with Ollama, OpenAI, Azure OpenAI, LM Studio, vLLM, and any custom endpoint.

---

### Decision 2: Azure DevOps LCS Diff

**Problem:** The Azure DevOps `/iterations/{id}/changes` endpoint returns file change metadata but not actual diff content.

**Decision:** Fetch file content at `sourceRefCommit` and `commonRefCommit` (merge base) for each changed file, then compute a unified diff using an LCS algorithm.

**Trade-offs:**
- Extra API calls (2 per changed file)
- LCS is O(m×n), capped at 600k line pairs; falls back to full-replacement diff for very large files
- Result: real `+`/`-` line diffs the LLM can meaningfully analyse

---

### Decision 3: LLM Generates Full Markdown Body

**Problem:** Early versions built comment templates from structured fields (severity, impacts, steps) extracted from the LLM response. Local models didn't reliably follow structured formats.

**Decision:** Show the LLM a concrete example of the full rendered markdown comment. The LLM writes the entire body. The parser only extracts `[File: path, Line: N]` for positioning.

**Result:** More natural output, fewer parsing failures, easier to customise by changing the prompt example.

---

### Decision 4: Path Normalisation

**Problem:** Azure DevOps stores file paths with a leading `/`. The LLM may omit it. Thread context `filePath` must match exactly, or Azure DevOps returns "file not found".

**Decision:** In `postReview`, build a `Map<normalisedPath, originalPath>`. Each comment's path is looked up after stripping the leading `/`. Comments with no matching path are skipped with a warning.

---

### Decision 5: Pipeline-Triggered Model (Layer 0)

**Decision:** The agent runs as a single-shot CLI process triggered by CI/CD — not a long-running server.

**Benefits:** No idle costs, no state management, no long-lived tokens, scales with CI runners.

**Evolution:** v2 adds a long-running Fastify server (Layer 2) for webhook-driven reviews with graph context. Layer 0 remains unchanged.

---

## Comment Format

Each inline comment uses this structure:

```markdown
**Suggestion:** [one-sentence description of the issue] [tag]

<details>
<summary><b>Severity Level:</b> Major ⚠️</summary>

- ⚠️ First concrete consequence
- ⚠️ Second concrete consequence
</details>

```suggestion
corrected_code_here()
```

**Steps of Reproduction:**

<details>
<summary><b>Steps of Reproduction ✅</b></summary>

1. Step one
2. Step two
</details>

<details>
<summary><b>Prompt for AI Agent 🤖</b></summary>

This is a comment left during a code review.
**Path:** /src/file.py
**Line:** 42
**Comment:** ...
Validate the correctness of the flagged issue. If correct, how can I resolve this?
</details>
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript / Node.js ≥ 18 |
| CLI Framework | `commander` |
| GitHub API | `@octokit/rest` |
| Azure DevOps API | `node-fetch` (REST) |
| LLM — Local | Ollama via Vercel AI SDK |
| LLM — Cloud | OpenAI, Azure OpenAI, Claude via Vercel AI SDK |
| Diff Algorithm | Myers LCS (custom implementation) |
| Build Tool | `tsc` (TypeScript compiler) |

---

## Consequences

**Positive:**
- Consistent review quality across all PRs
- Provider-agnostic: swap LLM without touching prompts or parsing
- Works fully offline with Ollama
- Rich, actionable comment format with AI fix prompts

**Negative:**
- Local models may not follow the output format as reliably as cloud models
- Azure DevOps diff requires N×2 API calls for N changed files
- Token limits cap diff size at ~30k characters

**Risks mitigated:**
- LLM hallucinating file paths → path validation against actual diff
- LLM output format drift → concrete example in prompt + fallback parser
- Azure rate limits → sequential file fetching
