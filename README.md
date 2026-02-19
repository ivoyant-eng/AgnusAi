# AgnusAI — AI-Powered PR Review Agent

An AI-powered code review agent that reviews pull requests on **GitHub** and **Azure DevOps**, posts rich inline comments with severity levels, reproduction steps, and AI fix prompts — all powered by your choice of LLM backend.

## Features

- 🤖 **Unified LLM Backend** — Vercel AI SDK with support for Ollama, OpenAI, Azure OpenAI, and any OpenAI-compatible endpoint
- 🔄 **Multi-platform** — GitHub and Azure DevOps
- 📍 **Inline Comments** — Rich formatted comments posted on specific lines in the diff
- 📚 **Skills-based** — Pluggable review skills matched by file patterns
- 🚀 **Pipeline-triggered** — Runs in CI/CD, no continuously running service
- 🔌 **Decoupled Architecture** — Prompt building and response parsing are shared across all providers

## Comment Format

Every inline comment follows a rich structured format:

```
**Suggestion:** [description of the issue] [tag]

<details>Severity Level: Major ⚠️</details>

```suggestion
// corrected code
```

**Steps of Reproduction:**
<details>Steps to reproduce...</details>

<details>Prompt for AI Agent 🤖</details>
```

Each comment includes collapsible **Severity**, **Steps of Reproduction**, and a ready-to-paste **AI Agent prompt** to fix the issue.

## Quick Start

```bash
git clone https://github.com/ivoyant-eng/AgnusAi.git
cd AgnusAi
npm install
npm run build

# Review a GitHub PR (dry run)
GITHUB_TOKEN=$(gh auth token) node dist/cli.js review \
  --pr 123 --repo owner/repo --dry-run

# Review an Azure DevOps PR
AZURE_DEVOPS_TOKEN=xxx node dist/cli.js review \
  --pr 456 --repo ivoyant/my-repo --vcs azure
```

## Installation

```bash
git clone https://github.com/ivoyant-eng/AgnusAi.git
cd AgnusAi
npm install
npm run build
```

## Configuration

### Config File

Create `~/.pr-review/config.yaml`:

```bash
mkdir -p ~/.pr-review
cp config.example.yaml ~/.pr-review/config.yaml
```

```yaml
# ~/.pr-review/config.yaml

vcs:
  github:
    token: ""              # or set GITHUB_TOKEN env var
  azure:
    organization: "my-org"
    project: "my-project"
    token: ""              # or set AZURE_DEVOPS_TOKEN env var

llm:
  provider: ollama         # ollama | openai | azure | custom
  model: qwen3.5:cloud
  providers:
    ollama:
      baseURL: http://localhost:11434/v1
    openai:
      baseURL: https://api.openai.com/v1
      apiKey: ${OPENAI_API_KEY}
    azure:
      baseURL: https://your-resource.openai.azure.com/openai/deployments/gpt-4
      apiKey: ${AZURE_OPENAI_KEY}
    custom:
      baseURL: https://your-endpoint.com/v1
      apiKey: ${CUSTOM_API_KEY}

skills:
  path: ~/.pr-review/skills
  default: default

review:
  maxDiffSize: 50000
  ignorePaths:
    - node_modules
    - dist
    - build
    - "*.lock"
```

### Environment Variables

| Variable | Description | Required For |
|----------|-------------|--------------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | GitHub reviews |
| `AZURE_DEVOPS_TOKEN` | Azure DevOps PAT | Azure DevOps reviews |
| `OPENAI_API_KEY` | OpenAI API Key | OpenAI provider |
| `AZURE_OPENAI_KEY` | Azure OpenAI Key | Azure provider |
| `CUSTOM_API_KEY` | Custom endpoint key | Custom provider |

See `.env.example` for full configuration options.

## LLM Backend

AgnusAI uses Vercel AI SDK's `@ai-sdk/openai-compatible` package to support any OpenAI-compatible endpoint:

- **Ollama** — Local, free (no API key needed)
- **OpenAI** — GPT-4, GPT-4o
- **Azure OpenAI** — Enterprise deployments
- **Custom** — Any OpenAI-compatible endpoint (LM Studio, vLLM, etc.)

### Quick Start with Ollama

```bash
ollama pull qwen3.5:cloud

node dist/cli.js review --pr 123 --repo owner/repo --provider ollama --model qwen3.5:cloud
```

**Recommended Models:**

| Model | Size | Best For |
|-------|------|----------|
| `qwen3.5:cloud` | ~0.5GB | Fast, general reviews |
| `qwen3.5:397b-cloud` | Cloud | High quality reviews |
| `codellama:70b` | 38GB | Complex code analysis |
| `deepseek-coder:33b` | 19GB | Code-specific reviews |

### Claude (Best Quality)

```bash
export ANTHROPIC_API_KEY=sk-ant-...

node dist/cli.js review --pr 123 --repo owner/repo --provider claude
```

**Models:** `claude-sonnet-4-20250514` (default), `claude-opus-4-20250514`

### OpenAI

```bash
export OPENAI_API_KEY=sk-...

node dist/cli.js review --pr 123 --repo owner/repo --provider openai
```

**Models:** `gpt-4o` (default), `gpt-4-turbo`, `gpt-3.5-turbo`

## CLI Commands

```bash
# Review a GitHub PR
node dist/cli.js review --pr 123 --repo owner/repo

# Review an Azure DevOps PR
node dist/cli.js review \
  --pr 456 \
  --repo ivoyant/my-repo \
  --vcs azure

# Use a specific provider and model
node dist/cli.js review --pr 123 --repo owner/repo \
  --provider claude --model claude-sonnet-4-20250514

# Dry run — show review without posting comments
node dist/cli.js review --pr 123 --repo owner/repo --dry-run

# Output as JSON
node dist/cli.js review --pr 123 --repo owner/repo --output json

# Use a specific skill
node dist/cli.js review --pr 123 --repo owner/repo --skill security

# List available skills
node dist/cli.js skills

# Show current config
node dist/cli.js config
```

## VCS Support

### GitHub

```bash
GITHUB_TOKEN=$(gh auth token) node dist/cli.js review \
  --pr 123 --repo owner/repo
```

### Azure DevOps

Azure org and project are read from `~/.pr-review/config.yaml`. The `--repo` flag takes the form `<any-prefix>/<repository-name>` — only the repository name (after `/`) is used.

```bash
AZURE_DEVOPS_TOKEN=xxx node dist/cli.js review \
  --pr 10295 \
  --repo ivoyant/orchestration-studio \
  --vcs azure
```

## Skills

Skills define review behaviour. They are markdown files with YAML front matter that get injected into the LLM prompt.

### Built-in Skills

| Skill | Triggers | Focus |
|-------|----------|-------|
| `default` | `**/*` | General correctness, patterns, best practices |
| `security` | `**/*.ts`, `**/api/**` | Vulnerabilities, auth, input validation |
| `frontend` | `**/*.tsx`, `**/*.css` | React patterns, a11y, performance |
| `backend` | `**/api/**`, `**/*.go` | API design, database, reliability |

### Creating a Custom Skill

```bash
mkdir -p ~/.pr-review/skills/my-skill
```

```markdown
---
name: My Custom Review
description: Custom review rules for our codebase
trigger:
  - "**/*.ts"
  - "src/**/*.js"
priority: high
---

# My Custom Review Rules

## What to Check
- No `any` types allowed
- All public functions must have JSDoc comments
- Max 50 lines per function
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                           │
│              node dist/cli.js review --pr 123 ...               │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                        PRReviewAgent                             │
│   - Orchestrates VCS, LLM, and Skills                           │
│   - Validates comment paths against diff                         │
│   - Caches diff to avoid duplicate API calls                    │
└──────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────┐   ┌───────────────────┐   ┌──────────────────┐
│ VCS Adapters │   │   LLM Backends    │   │  Skill Loader    │
│              │   │                   │   │                  │
│ - GitHub     │   │  BaseLLMBackend   │   │ Matches skills   │
│ - Azure      │   │  ┌─────────────┐  │   │ by file glob     │
│   DevOps     │   │  │ prompt.ts   │  │   │ patterns         │
└──────────────┘   │  │ (shared)    │  │   └──────────────────┘
                   │  └─────────────┘  │
                   │  ┌─────────────┐  │
                   │  │ parser.ts   │  │
                   │  │ (shared)    │  │
                   │  └─────────────┘  │
                   │  ┌─────┐ ┌─────┐  │
                   │  │Ollam│ │Claud│  │
                   │  │  a  │ │  e  │  │
                   │  └─────┘ └─────┘  │
                   │  ┌─────┐          │
                   │  │OpenA│          │
                   │  │  I  │          │
                   │  └─────┘          │
                   └───────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Output Layer                              │
│  - Rich inline comments (Severity + Steps + AI Fix Prompt)      │
│  - General summary comment                                       │
│  - Verdict: approve | request_changes | comment                 │
│  - Azure DevOps vote (approve/waiting for author)               │
└──────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `BaseLLMBackend` abstract class | `prompt.ts` and `parser.ts` are shared — adding a new provider requires only implementing `generate()` |
| LCS-based diff for Azure DevOps | Azure DevOps API doesn't return unified diffs; we fetch file content at source/target commits and compute the diff ourselves |
| Path normalisation in `postReview` | Azure DevOps paths have a leading `/`; LLM output may omit it — normalised paths are validated against actual diff file list before posting |
| Model generates full markdown body | The LLM writes the entire comment (Severity, Steps, AI prompt) directly — no template stitching needed |

## Project Structure

```
AgnusAi/
├── src/
│   ├── index.ts                  # PRReviewAgent orchestrator
│   ├── cli.ts                    # CLI entry point
│   ├── types.ts                  # TypeScript types
│   ├── adapters/
│   │   └── vcs/
│   │       ├── base.ts           # VCSAdapter interface
│   │       ├── github.ts         # GitHub adapter
│   │       └── azure-devops.ts   # Azure DevOps adapter (LCS diff, path normalisation)
│   └── llm/
│       ├── base.ts               # BaseLLMBackend abstract class
│       ├── prompt.ts             # Shared prompt builder
│       ├── parser.ts             # Shared response parser
│       ├── ollama.ts             # Ollama API call
│       ├── claude.ts             # Claude API call
│       └── openai.ts             # OpenAI API call
├── skills/
│   ├── default/SKILL.md
│   ├── security/SKILL.md
│   ├── frontend/SKILL.md
│   └── backend/SKILL.md
├── config.example.yaml
└── package.json
```

## CI/CD Integration

### GitHub Actions

```yaml
name: AI PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install AgnusAI
        run: |
          git clone https://github.com/ivoyant-eng/AgnusAi.git
          cd AgnusAi && npm install && npm run build

      - name: Run Review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          cd AgnusAi
          node dist/cli.js review \
            --pr ${{ github.event.pull_request.number }} \
            --repo ${{ github.repository }} \
            --provider claude
```

### Azure Pipelines

```yaml
trigger: none
pr:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: |
      git clone https://github.com/ivoyant-eng/AgnusAi.git
      cd AgnusAi && npm install && npm run build
    displayName: 'Install AgnusAI'

  - script: |
      cd AgnusAi
      node dist/cli.js review \
        --pr $(System.PullRequest.PullRequestId) \
        --repo ivoyant/$(Build.Repository.Name) \
        --vcs azure
    displayName: 'Run Review'
    env:
      AZURE_DEVOPS_TOKEN: $(System.AccessToken)
      ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY)
```

## Roadmap

### ✅ Phase 1 — Foundation
- [x] GitHub adapter
- [x] Ollama backend
- [x] CLI skeleton
- [x] Context builder
- [x] Inline comments on specific lines

### ✅ Phase 2 — Multi-provider
- [x] Claude backend
- [x] OpenAI backend
- [x] Azure DevOps adapter with LCS-based real diff
- [x] Decoupled `prompt.ts` / `parser.ts` shared across all providers
- [x] Rich comment format (Severity, Steps of Reproduction, AI Fix Prompt)

### 🔲 Phase 3 — Ticket Integration
- [ ] Jira adapter
- [ ] Linear adapter
- [ ] GitHub Issues adapter
- [ ] Azure Boards adapter
- [ ] Memory system (learned conventions)

### 🔲 Phase 4 — Distribution
- [ ] Binary distribution (pkg/bun)
- [ ] npm global install
- [ ] Homebrew formula

---

## 🚀 v2 Roadmap — Closing the Gap with CodeRabbit

The following features are planned to bring AgnusAI to feature parity with CodeRabbit and beyond.

### Priority Overview

| Priority | Feature | Impact | Effort | Status |
|----------|---------|--------|--------|--------|
| **P1** | Incremental PR Reviews | 🔴 High | 🟡 Medium | 🔲 Not Started |
| **P1** | Comment Reply Handling | 🔴 High | 🟢 Low | 🔲 Not Started |
| **P2** | TypeScript Type Checking | 🟡 Medium | 🟡 Medium | 🔲 Not Started |
| **P2** | Codebase Embeddings | 🔴 High | 🔴 High | 🔲 Not Started |
| **P3** | Multi-language LSP | 🟡 Medium | 🔴 High | 🔲 Not Started |
| **P3** | Impact Analysis | 🔴 High | 🔴 High | 🔲 Not Started |

---

### P1: Incremental PR Reviews

**Goal:** Only review new changes after user commits, avoiding duplicate reviews.

| Component | Description | Status |
|-----------|-------------|--------|
| SHA Tracking | Store `lastReviewedSHA` in comment metadata | 🔲 |
| GitHub Compare API | Use `/repos/{owner}/{repo}/compare/{base}...{head}` for incremental diff | 🔲 |
| Comment Validation | Check if existing comments are still valid on changed files | 🔲 |
| Stale Comment Handling | Mark or resolve outdated comments when files change | 🔲 |

**Technical Approach:**
```
GitHub Webhook → PR Event Handler → Incremental Diff Analyzer
     │
     ▼
Check lastReviewedSHA → Fetch diff since last review → Review delta only
     │
     ▼
Update lastReviewedSHA in comment metadata
```

---

### P1: Comment Reply Handling (Conversation Threads)

**Goal:** Handle replies to AI comments via webhook, enabling contextual conversations.

| Component | Description | Status |
|-----------|-------------|--------|
| Webhook Handler | Listen for `pull_request_review_comment` events | 🔲 |
| Reply API Integration | `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` | 🔲 |
| Context Building | Include original issue + user's reply for LLM context | 🔲 |
| Conversation Memory | Track thread history for coherent responses | 🔲 |

**Technical Approach:**
```
User replies to AI comment → Webhook triggers handler
     │
     ▼
Fetch original comment context → Build prompt with thread history
     │
     ▼
LLM generates response → Post as reply via GitHub API
```

---

### P2: LSP Integration for Type-Aware Reviews

**Goal:** Leverage TypeScript Compiler API for type-aware code reviews.

| Component | Description | Status |
|-----------|-------------|--------|
| TypeScript Compiler API | Use `ts.createProgram()` for type analysis | 🔲 |
| Type Extraction | `checker.getTypeAtLocation()` for symbol info | 🔲 |
| Diagnostic Collection | Extract TypeScript errors/warnings | 🔲 |
| Context Injection | Add type information to review prompt | 🔲 |
| Signatures & Types | Include function signatures, return types, generics | 🔲 |

**Technical Approach:**
```
LSP Manager → TypeScript Program (ts.createProgram)
     │
     ▼
TypeChecker → getTypeAtLocation() → Extract types, diagnostics
     │
     ▼
Context Builder → Inject type info into review prompt
     │
     ▼
LLM Backend → Type-aware review with rich context
```

**Example Context Injection:**
```typescript
// Type context added to prompt
// Function: `processData(input: unknown)`
// Inferred type: `input: { id: string; data: Record<string, unknown> }`
// Diagnostic: 'unsafe assignment of type `unknown`'
```

---

### P2: Codebase Embeddings (Context Awareness)

**Goal:** Enable semantic codebase understanding for better review context.

| Component | Description | Status |
|-----------|-------------|--------|
| Embedding Generation | Use Vercel AI SDK `embedMany()` for batch embeddings | 🔲 |
| Vector Database | Store embeddings in Qdrant (recommended) | 🔲 |
| Chunking Strategy | Chunk by function/class with metadata | 🔲 |
| Similarity Search | Query similar patterns during review | 🔲 |
| Dependents Query | Find files that import/depend on changed code | 🔲 |

**Technical Approach:**
```
Codebase → Chunker (function/class level) → embedMany()
     │
     ▼
Vector DB (Qdrant) ← Store with metadata (file, line, type)
     │
     ▼
During Review → Query similar patterns → Inject into context
     │
     ▼
Impact Analysis → Find dependents/usages of changed code
```

**Metadata Schema:**
```typescript
interface CodeChunk {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    file: string;
    startLine: number;
    endLine: number;
    type: 'function' | 'class' | 'interface' | 'constant';
    name: string;
    exports: string[];
    imports: string[];
  };
}
```

---

### P3: Multi-language LSP + Impact Analysis

**Goal:** Extend LSP support beyond TypeScript and enable impact analysis.

| Language | LSP Server | Status |
|----------|------------|--------|
| TypeScript | `ts.createProgram()` | 🔲 (P2) |
| Python | Pyright / Pylance | 🔲 |
| Go | gopls | 🔲 |
| Rust | rust-analyzer | 🔲 |
| Java | jdtls | 🔲 |

**Impact Analysis Features:**
- [ ] Find all dependents of changed functions/classes
- [ ] Detect breaking API changes
- [ ] Suggest related files that may need updates
- [ ] Generate call graphs for affected code paths

---

## Architecture Overview (v2)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         GitHub Webhook                               │
│                   (PR events, comment replies)                       │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        PR Event Handler                              │
│              • Incremental Diff Analyzer                             │
│              • Comment Manager (post/reply/resolve)                  │
└──────────────────────────────────────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   LSP Manager    │  │   Context Builder │  │    Vector DB     │
│                  │  │                   │  │    (Qdrant)      │
│ • TypeScript     │  │ • Diff context    │  │                  │
│ • Python (P3)    │  │ • Type info       │  │ • Embeddings     │
│ • Go (P3)        │  │ • Similar code    │  │ • Metadata       │
│ • Rust (P3)      │  │ • Thread history  │  │ • Queries        │
└──────────────────┘  └──────────────────┘  └──────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        LLM Backend                                   │
│                   (Vercel AI SDK)                                    │
│              • Ollama • Claude • OpenAI                              │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Comment Manager                               │
│              • Post inline comments                                   │
│              • Reply to threads                                       │
│              • Resolve stale comments                                 │
│              • Update lastReviewedSHA                                 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Order

Recommended implementation sequence based on impact vs. effort:

```
Week 1-2:  P1 - Comment Reply Handling (Low effort, High impact)
Week 2-3:  P1 - Incremental Reviews (Medium effort, High impact)
Week 4-5:  P2 - TypeScript Type Checking (Medium effort, Medium impact)
Week 6-8:  P2 - Codebase Embeddings (High effort, High impact)
Week 9+:   P3 - Multi-language LSP + Impact Analysis
```

---

**Want to contribute?** Check our [CONTRIBUTING.md](./CONTRIBUTING.md) or pick up an issue from the roadmap!

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

## Author

[Ashish Maurya](https://github.com/theashishmaurya) — [ivoyant](https://github.com/ivoyant-eng)
