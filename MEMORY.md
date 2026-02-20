# AgnusAI - Project Memory

## What is AgnusAI?

AI-powered PR review agent that posts rich inline comments on GitHub and Azure DevOps. Runs as CLI/CI pipeline, not a service.

**Key Features:**
- Multi-platform: GitHub + Azure DevOps
- Multi-LLM: Ollama, OpenAI, Azure OpenAI, any OpenAI-compatible endpoint
- Skills-based: Pluggable review skills matched by file patterns
- Rich comments: Severity levels, reproduction steps, AI fix prompts

**Repo:** https://github.com/ivoyant-eng/AgnusAi

---

## Roadmap

### ✅ Phase 1 — Foundation (COMPLETE)
- Skills folder structure and loader
- GitHub adapter (getPR, getDiff, inline comments)
- Ollama backend
- CLI skeleton (`review`, `skills`, `config` commands)
- Context builder
- Inline comments on specific diff lines

### ✅ Phase 2 — Multi-provider + Azure (COMPLETE)
- Unified LLM Backend (Vercel AI SDK)
- Azure DevOps adapter with LCS-based real diff
- Decoupled `prompt.ts` / `parser.ts` shared across all providers
- Rich inline comment format (Severity, Steps of Reproduction, AI Fix Prompt)
- Path normalisation and validation before posting
- Duplicate comment fix

### ✅ Phase 2.5 — Deduplication & Webhooks (PR #5 - IN REVIEW)
- **Comment Deduplication:** Prevents duplicate comments on same lines
- **Platform-Agnostic Architecture:** VCSAdapter interface for GitHub + Azure DevOps
- **Edge Case Handling:** Deleted files, renamed files, draft PRs, binary files, rate limiting
- **Comment Reply Handling:** LLM-powered contextual replies to user comments
- **Webhook Handler:** GitHub webhook for automatic reply generation

**PR #5 Status:** OPEN, all stress tests passed (5 rounds)
- Files: 18 | +12,517 / -390
- Key files: `deduplication.ts`, `comment-manager.ts`, `thread.ts`, `reply.ts`, `webhook/handler.ts`

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

## Architecture

```
src/
├── index.ts              # PRReviewAgent — main orchestrator
├── cli.ts                # CLI commands
├── types.ts              # All TypeScript interfaces
│
├── adapters/vcs/
│   ├── base.ts           # VCSAdapter interface
│   ├── github.ts         # GitHub implementation
│   └── azure-devops.ts   # Azure DevOps (LCS diff)
│
├── llm/
│   ├── base.ts           # BaseLLMBackend abstract
│   ├── prompt.ts         # Shared prompt builder
│   └── parser.ts         # Shared response parser
│
├── review/
│   ├── deduplication.ts  # Core deduplication logic
│   ├── comment-manager.ts # Platform-agnostic manager
│   ├── checkpoint.ts     # Progress tracking
│   ├── thread.ts         # Thread types/utilities
│   └── reply.ts          # LLM-powered replies
│
└── webhook/
    └── handler.ts        # GitHub webhook processing
```

---

## How to Run

### Local Review (Dry Run)
```bash
cd /root/.openclaw/workspace/projects/pr-review-agent
npm run build

# GitHub
GITHUB_TOKEN=$(gh auth token) node dist/cli.js review \
  --pr 123 --repo owner/repo --dry-run

# Azure DevOps
AZURE_DEVOPS_TOKEN=xxx node dist/cli.js review \
  --pr 456 --repo ivoyant/my-repo --vcs azure --dry-run
```

### Run Tests
```bash
npm test
```

---

## Stress Testing Incremental Reviews

### Test Repositories

| Platform | Repo | Purpose |
|----------|------|---------|
| **GitHub** | `theashishmaurya/pr-review-test` | Stress testing incremental reviews, deduplication |
| **Azure DevOps** | `AshishM0615/GitTestAzure/AgnusStressTestAzure` | Stress testing Azure adapter, line positioning |

### What It Tests
When a PR has existing AgnusAI comments and new commits are pushed, the agent should:
1. Detect previously reviewed files via checkpoint
2. Only review NEW/CHANGED lines (not re-review old code)
3. Merge new comments with existing ones
4. Not duplicate comments on same lines

### How to Run Stress Test
```bash
cd /root/.openclaw/workspace/projects/pr-review-agent

# GitHub (test repo)
GITHUB_TOKEN=$(gh auth token) node dist/cli.js review \
  --pr 5 --repo theashishmaurya/pr-review-test --dry-run

# Azure DevOps (test repo)
node dist/cli.js review \
  --pr 6 --repo GitTestAzure/AgnusStressTestAzure --vcs azure --dry-run
```

### Stress Test Results (2026-02-20)

#### GitHub PR #5 (theashishmaurya/pr-review-test)
- **Test:** Full review + incremental
- **Rounds:** 2/2 passed ✅
- **Issues Found:** Debug logging hardcoded, memory leak in logger, SQL injection, hardcoded credentials
- **Incremental:** Checkpoint detection working ✅

#### Azure DevOps PR #6 (GitTestAzure/AgnusStressTestAzure)
- **Test:** Full review
- **Rounds:** 1 passed ✅
- **Issues Found:** Critical security vulnerabilities (input validation, token generation)
- **Line positioning:** Correct ✅

---

## Edge Cases Handled

### Comment Management
- ✅ Duplicate comments on same line
- ✅ Comments on deleted files/lines
- ✅ Comments on renamed files
- ✅ Issues already fixed (code changed)
- ✅ Dismissed comments (wontfix)

### PR States
- ✅ Draft PRs (skip by default)
- ✅ Merged/closed PRs
- ✅ Force pushed commits
- ✅ Large PRs (limit comments)

### File Types
- ✅ Binary files (images, fonts, archives)
- ✅ Generated files (*.min.js, *.min.css)
- ✅ Lock files (package-lock.json, pnpm-lock.yaml)

### Performance & Safety
- ✅ Rate limiting (5,000 req/hour)
- ✅ Idempotency keys for deduplication
- ✅ Timeout protection
- ✅ Concurrent request handling
- ✅ Stale checkpoint detection

---

## VCSAdapter Interface

```typescript
interface VCSAdapter {
  getReviewComments(prNumber): Promise<PRComment[]>;
  createReviewComment(comment): Promise<void>;
  updateComment(id, body): Promise<void>;
  deleteComment(id): Promise<void>;
  findCheckpointComment(prNumber): Promise<Comment | null>;
  getFileRenames(prNumber): Promise<FileRename[]>;
  getPR(prId: string | number): Promise<PullRequest>;
  getDiff(prId: string | number): Promise<Diff>;
  getFiles(prId: string | number): Promise<FileInfo[]>;
  submitReview(prId: string | number, review: Review): Promise<void>;
}
```

---

## Comment Format

Every AgnusAI comment follows this structure:

```markdown
**Suggestion:** [description] [tag]

<details>Severity Level: Major ⚠️</details>

```suggestion
// corrected code
```

**Steps of Reproduction:**
<details>Steps...</details>

<details>Prompt for AI Agent 🤖</details>
```

**AGNUSAI Marker:** All comments include a hidden marker `[//]: # (AGNUSAI)` for identification.

---

## Configuration

Config file: `~/.pr-review/config.yaml`

```yaml
vcs:
  github:
    token: ""              # or GITHUB_TOKEN env var
  azure:
    organization: "my-org"
    project: "my-project"
    token: ""              # or AZURE_DEVOPS_TOKEN env var

llm:
  provider: ollama         # ollama | openai | azure | custom
  model: qwen3.5:cloud
  providers:
    ollama:
      baseURL: http://localhost:11434/v1
    openai:
      apiKey: ${OPENAI_API_KEY}

skills:
  path: ~/.pr-review/skills
```

---

## Key Learnings

### 1. LLM Generates Full Markdown
Early versions tried to parse structured fields from LLM response. Local models didn't reliably follow format.

**Solution:** Show LLM a concrete example of full rendered markdown. Parser only extracts `[File: path, Line: N]` for positioning.

### 2. Azure DevOps Has No Diff Endpoint
Azure API returns file change metadata but not actual diff content.

**Solution:** Fetch file content at source and base commits, compute unified diff via LCS algorithm. Capped at 600k line pairs.

### 3. Path Normalisation Matters
Azure DevOps uses `/src/foo.ts` but LLM might output `src/foo.ts`.

**Solution:** Build `Map<normalisedPath, originalPath>` from diff. Look up comments after stripping leading `/`.

---

## Current Work (2026-02-20)

1. **PR #5 Review** — waiting for final approval to merge
2. **Testing resolved comments** — need to test how AgnusAI behaves when comments are resolved without new commits (does it re-post?)
3. **Medium/Notion publishing** — marketing agent had issues, needs fix

---

## Contacts

- **Owner:** Ashish Maurya (@theashishmaurya)
- **Repo:** ivoyant-eng/AgnusAi
- **Branches:**
  - `master` — stable
  - `feature/incremental-reviews` — PR #5
  - `feature/comment-reply-threads`
  - `feature/vercel-ai-sdk`