# Development Setup

## Prerequisites

- Node.js 18+
- pnpm 8+ (`npm install -g pnpm`)
- Docker + Docker Compose (for Postgres + Ollama when developing the API)
- (Optional) Ollama — for local LLM testing without API keys

## Clone and Install

```bash
git clone https://github.com/theashishmaurya/AgnusAi.git
cd AgnusAi
pnpm install
```

## Build All Packages

```bash
pnpm build
```

This builds packages in dependency order:

| Package | Output |
|---------|--------|
| `@agnus-ai/shared` | `packages/shared/dist/` |
| `@agnus-ai/core` | `packages/core/dist/` |
| `@agnus-ai/reviewer` | `packages/reviewer/dist/` |
| `@agnus-ai/api` | `packages/api/dist/` |
| `@agnus-ai/docs` | `packages/docs/.vitepress/dist/` |

## Build a Single Package

```bash
pnpm --filter @agnus-ai/reviewer build
pnpm --filter @agnus-ai/core build
pnpm --filter @agnus-ai/api build
```

## Run the CLI (reviewer)

```bash
# GitHub PR — dry run (no comments posted)
GITHUB_TOKEN=$(gh auth token) node packages/reviewer/dist/cli.js review \
  --pr 123 --repo owner/repo --dry-run

# With Claude
GITHUB_TOKEN=$(gh auth token) ANTHROPIC_API_KEY=sk-ant-... \
  node packages/reviewer/dist/cli.js review \
  --pr 123 --repo owner/repo --provider claude --incremental

# Azure DevOps
AZURE_DEVOPS_TOKEN=xxx node packages/reviewer/dist/cli.js review \
  --pr 456 --repo ivoyant/my-repo --vcs azure
```

## Run the API Server (hosted mode)

```bash
# Start Postgres + Ollama via Docker Compose
docker compose up -d postgres ollama

# Copy and fill in environment
cp .env.example .env

# Start the API
pnpm --filter @agnus-ai/api start
```

The server starts on `http://localhost:3000`.

## Watch Mode (auto-rebuild on file change)

```bash
# Rebuild reviewer on every change
pnpm --filter @agnus-ai/reviewer build -- --watch
```

Run the CLI or API server in a separate terminal while watch mode is active.

## Docs Development

```bash
# Live preview at http://localhost:5173/docs/
pnpm --filter @agnus-ai/docs dev

# Production build
pnpm --filter @agnus-ai/docs build
```

## Environment Variables Reference

See [Environment Variables](/guide/env-vars) for a full reference.

Quick reference for development:

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub PAT for posting review comments |
| `AZURE_DEVOPS_TOKEN` | Azure DevOps PAT |
| `ANTHROPIC_API_KEY` | Claude provider |
| `OPENAI_API_KEY` | OpenAI provider |
| `DATABASE_URL` | Postgres connection string (API only) |
| `EMBEDDING_PROVIDER` | `ollama`, `openai`, `google`, `http` |

## Adding a New LLM Provider

The reviewer uses [Vercel AI SDK](https://sdk.vercel.ai/) with a `UnifiedLLMBackend`. Any OpenAI-compatible endpoint works with only a config entry — no code changes needed.

For a non-OpenAI-compatible provider, extend `BaseLLMBackend` in `packages/reviewer/src/llm/` and implement `generate()`.

## Adding a New Language Parser

1. Create `packages/core/src/parser/YourLangParser.ts` extending `TreeSitterParser`
2. Implement `init()` (loads the Tree-sitter grammar WASM), `parseSymbols()`, and `parseEdges()`
3. Register it in `packages/core/src/parser/ParserRegistry.ts` inside `createDefaultRegistry()`
4. Add the language's file extensions to `INDEXED_EXTENSIONS` in `packages/core/src/indexer/Indexer.ts`

Parsers fail gracefully — if the Tree-sitter WASM can't load (e.g. ABI version mismatch), a warning is logged and the remaining parsers continue normally.
