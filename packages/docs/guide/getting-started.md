# Quick Start (CLI)

The CLI reviewer works with no database, no server, and no indexing. It's the fastest way to get a review on any PR.

## Prerequisites

- Node.js 18+
- pnpm 8+
- A GitHub or Azure DevOps token with PR read/write permissions
- An LLM backend (Ollama locally, or any cloud provider)

## Installation

```bash
git clone https://github.com/ivoyant-eng/AgnusAi
cd AgnusAi
pnpm install
pnpm --filter @agnus-ai/reviewer build
```

## Configure Environment

Copy the example and fill in the required values:

```bash
cp .env.example .env
```

Minimum required for CLI:

```bash
# LLM provider
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5-coder

# GitHub token
GITHUB_TOKEN=ghp_...
```

## Run Your First Review

```bash
node packages/reviewer/dist/cli.js review --pr 42 --repo owner/repo
```

The reviewer will:
1. Fetch the PR diff from GitHub
2. Match skills against changed file paths
3. Build an LLM prompt with the diff + skills
4. Parse inline comments from the response
5. Post them as GitHub review comments

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--pr` | required | PR number |
| `--repo` | required | `owner/repo` |
| `--platform` | `github` | `github` or `azure` |
| `--incremental` | false | Skip files already reviewed in last run |
| `--dry-run` | false | Print comments without posting |

## Using with Ollama

Make sure Ollama is running and you've pulled a model:

```bash
ollama serve
ollama pull qwen2.5-coder   # good general-purpose code model
# or
ollama pull codellama        # lighter, faster
```

Then set in `.env`:

```bash
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5-coder
```

## Using with OpenAI

```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini   # or gpt-4o for deeper analysis
```

## Using with Claude

```bash
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6
```

## Next Steps

- [Set up the hosted service →](./hosted-setup) for automatic PR reviews and blast radius analysis
- [Configure skills →](../reference/skills) to focus the reviewer on your team's conventions
- [Review modes →](./review-modes) to understand fast / standard / deep analysis
