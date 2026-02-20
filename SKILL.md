# AgnusAI - PR Review Agent

## Description
AI-powered PR review agent for GitHub and Azure DevOps. Posts rich inline comments with severity levels, reproduction steps, and AI fix prompts.

## Common Commands

### Build
```bash
cd /root/.openclaw/workspace/projects/pr-review-agent
npm run build
```

### Run Review (Dry Run)
```bash
# GitHub
GITHUB_TOKEN=$(gh auth token) node dist/cli.js review \
  --pr <PR_NUMBER> --repo <owner/repo> --dry-run

# Azure DevOps
node dist/cli.js review \
  --pr <PR_NUMBER> --repo <Project/Repository> --vcs azure --dry-run
```

### Azure DevOps Config
```yaml
# ~/.pr-review/config.yaml
vcs:
  azure:
    organization: "YourOrg"
    project: "YourProject"
    token: "${AZURE_DEVOPS_TOKEN}"  # PAT with Code Read/Write scope

llm:
  provider: ollama
  model: qwen3.5:cloud
```

### Run Tests
```bash
npm test
```

### Stress Test Incremental Reviews
```bash
node dist/cli.js test:incremental --pr <PR_NUMBER> --rounds 5
```

## Project Structure

```
src/
├── index.ts              # Main orchestrator (PRReviewAgent)
├── cli.ts                # CLI entry point
├── types.ts              # TypeScript interfaces
├── adapters/vcs/         # GitHub, Azure DevOps adapters
├── llm/                  # LLM backends (prompt.ts, parser.ts shared)
├── review/               # Deduplication, comments, checkpoint
└── webhook/              # GitHub webhook handler
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main agent logic, orchestrates review flow |
| `src/llm/prompt.ts` | Shared prompt builder (edit to change review format) |
| `src/llm/parser.ts` | Shared response parser |
| `src/adapters/vcs/base.ts` | VCSAdapter interface |
| `src/review/deduplication.ts` | Prevents duplicate comments |
| `src/review/comment-manager.ts` | Platform-agnostic comment handling |
| `src/review/checkpoint.ts` | Progress tracking for incremental reviews |

## Configuration

Config file: `~/.pr-review/config.yaml`

```yaml
llm:
  provider: ollama
  model: qwen3.5:cloud

vcs:
  github:
    token: ""  # or GITHUB_TOKEN env
```

## Current Branches

- `master` — stable production
- `feature/incremental-reviews` — PR #5 (deduplication + incremental)
- `feature/comment-reply-threads`
- `feature/vercel-ai-sdk`

## Roadmap

- ✅ Phase 1: Foundation (GitHub, Ollama, CLI)
- ✅ Phase 2: Multi-provider + Azure DevOps
- 🔄 Phase 2.5: Deduplication & Webhooks (PR #5 in review)
- 🔲 Phase 3: Ticket Integration (Jira, Linear, GitHub Issues)
- 🔲 Phase 4: Distribution (npm, Homebrew, binary)

## See Also

- `MEMORY.md` — Full project memory, roadmap, stress test procedures
- `ADR-001-architecture.md` — Architecture decisions
- `CONTRIBUTING.md` — How to add providers/adapters

## Claude Code Integration

For complex coding tasks, use Claude Code CLI:

```bash
cd /root/.openclaw/workspace/projects/pr-review-agent
ollama launch claude --model qwen3-coder-next
```

**When to use Claude Code:**
- Complex refactoring across multiple files
- Architecture exploration and analysis
- Multi-file feature implementation
- Deep debugging with codebase search

**When to use Agnus agent:**
- Quick fixes and git operations
- Stress testing and validation
- PR management and updates
- Automated review runs

See `/root/.openclaw/workspace/skills/claude-code/SKILL.md` for full documentation.