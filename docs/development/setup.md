# Development Setup

## Prerequisites

- Node.js 18+
- npm 9+
- (Optional) Ollama — for local LLM testing without API keys

## Install and Build

```bash
git clone https://github.com/ivoyant-eng/AgnusAi.git
cd AgnusAi
npm install
npm run build
```

The build output goes to `dist/`. The entry point is `dist/cli.js`.

## Configuration

### Config File

Create `~/.pr-review/config.yaml`:

```bash
mkdir -p ~/.pr-review
cp config.example.yaml ~/.pr-review/config.yaml
```

Key fields:

```yaml
vcs:
  github:
    token: ""              # or GITHUB_TOKEN env var
  azure:
    organization: "my-org"
    project: "my-project"
    token: ""              # or AZURE_DEVOPS_TOKEN env var

llm:
  provider: ollama         # ollama | openai | azure | claude | custom
  model: qwen3.5:cloud

review:
  maxDiffSize: 50000       # characters; diffs larger than this are truncated
  ignorePaths:
    - node_modules
    - dist
    - "*.lock"
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub PAT (reviews + webhooks) |
| `AZURE_DEVOPS_TOKEN` | Azure DevOps PAT |
| `ANTHROPIC_API_KEY` | Claude provider |
| `OPENAI_API_KEY` | OpenAI provider |
| `AZURE_OPENAI_KEY` | Azure OpenAI provider |

## Running a Review

```bash
# GitHub PR — dry run (no comments posted)
GITHUB_TOKEN=$(gh auth token) node dist/cli.js review \
  --pr 123 --repo owner/repo --dry-run

# GitHub PR — real run with Claude
GITHUB_TOKEN=$(gh auth token) \
ANTHROPIC_API_KEY=sk-ant-... \
node dist/cli.js review \
  --pr 123 --repo owner/repo \
  --provider claude --incremental

# Azure DevOps PR
AZURE_DEVOPS_TOKEN=xxx node dist/cli.js review \
  --pr 456 --repo ivoyant/my-repo --vcs azure
```

## Watch Mode (Development)

```bash
npm run build -- --watch
```

Then in another terminal run reviews against a test PR.

## Useful CLI Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Print review without posting |
| `--incremental` | Only review new commits since last checkpoint |
| `--output json` | Machine-readable JSON output |
| `--skill security` | Override skill selection |
| `--provider claude` | Override LLM provider |
| `--model claude-sonnet-4-6` | Override model |

## Adding a New LLM Provider

1. Add config entry in `~/.pr-review/config.yaml` under `llm.providers`
2. No code changes needed — `UnifiedLLMBackend` wraps any OpenAI-compatible endpoint

For a non-OpenAI-compatible provider, extend `BaseLLMBackend` in `src/llm/` and implement `generate()`.
