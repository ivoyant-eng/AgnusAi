# Contributing to Ryv AI

Thank you for your interest in contributing! This guide covers everything you need to get set up, what to work on, and how to submit changes.

---

## Before You Start

- Check [open issues](https://github.com/ivoyant-eng/AgnusAi/issues) for things to work on
- For large features, open an issue first to discuss the approach
- Small fixes and docs improvements can be submitted directly as PRs

---

## Dev Setup

See [Dev Setup](/development/setup) for the full walkthrough. Quick version:

```bash
git clone https://github.com/ivoyant-eng/AgnusAi.git
cd AgnusAi
pnpm install
pnpm build
```

**Prerequisites:** Node.js 18+, pnpm 8+, Docker (for Postgres + Ollama during API development).

---

## Monorepo Structure

```
packages/
├── shared/     — TypeScript types shared across all packages
├── core/       — Tree-sitter parsers, graph engine, indexer, retriever
├── reviewer/   — CLI reviewer and LLM backends
├── api/        — Fastify server (webhooks, REST, SSE)
├── dashboard/  — Vite React SPA
└── docs/       — VitePress docs (this site)
```

**Build order matters:** `shared` → `core` → `reviewer` → `api`. Dashboard and docs are independent.

When you change `shared` types, rebuild `shared` before building downstream packages.

---

## What to Contribute

### Adding a New LLM Provider

The reviewer uses a `UnifiedLLMBackend` in `packages/reviewer/src/llm/unified.ts`. For OpenAI-compatible endpoints (most hosted models), only a config entry is needed — no code changes.

For a non-OpenAI-compatible provider:

1. Create `packages/reviewer/src/llm/<provider>.ts` extending `BaseLLMBackend`
2. Implement `generate(prompt, context): Promise<string>` — just the API call, nothing else
3. Register it in `packages/reviewer/src/cli.ts`
4. Export from `packages/reviewer/src/index.ts`
5. Add the provider name to the `LLMConfig.provider` union in `packages/reviewer/src/types.ts`

### Adding a New Language Parser

Language support lives in `packages/core/src/parser/`.

1. Create `packages/core/src/parser/YourLangParser.ts` extending `TreeSitterParser`
2. Implement `init()` (loads the Tree-sitter grammar WASM), `parseSymbols()`, and `parseEdges()`
3. Register in `packages/core/src/parser/ParserRegistry.ts` inside `createDefaultRegistry()`
4. Add file extensions to `INDEXED_EXTENSIONS` in `packages/core/src/indexer/Indexer.ts`

Parsers fail gracefully — a failed WASM load logs a warning and the rest continue.

### Adding a New VCS Adapter

VCS adapters live in `packages/reviewer/src/adapters/vcs/`.

1. Create `<platform>.ts` implementing the `VCSAdapter` interface from `base.ts`
2. `getDiff()` must return unified diff hunks — see `azure-devops.ts` for the LCS pattern if your platform lacks a raw diff endpoint
3. Register the adapter in `packages/reviewer/src/cli.ts`

### Creating or Improving Skills

Skills are Markdown files that get injected into the LLM prompt based on file-glob matching.

```markdown
---
name: My Skill
description: What this skill reviews
trigger:
  - "**/*.py"
  - "src/api/**"
priority: high   # high | medium | low
---

# Review Focus

What to look for in these files...

## Common Issues
- Issue 1
- Issue 2
```

Built-in skills live in `packages/reviewer/skills/`. User skills live in `~/.pr-review/skills/` and are not tracked in the repo.

Tips for good skills:
- Be specific — vague instructions produce vague reviews
- Include examples of bad patterns and what to suggest instead
- Keep skills focused on one concern (security, performance, API style, etc.)
- Higher `priority` skills are injected first into the prompt

### Improving the Dashboard

The dashboard is a Vite React SPA in `packages/dashboard/src/` using shadcn/ui components.

Run the dev server:
```bash
pnpm --filter @agnus-ai/dashboard dev   # http://localhost:5173
```

The API must be running for most dashboard features to work. Design system details: [Dev Setup → Dashboard](/development/setup).

### Improving the Docs

Docs live in `packages/docs/` and are served via VitePress.

```bash
pnpm --filter @agnus-ai/docs dev   # live preview at http://localhost:5173/docs/
```

Add pages to the sidebar in `packages/docs/.vitepress/config.ts`.

---

## Code Style

- **TypeScript strict mode** — no `any` types
- **Thin provider files** — only the API call; shared logic stays in `prompt.ts` / `parser.ts`
- **No unnecessary abstractions** — three similar lines of code is better than a premature helper
- **Error messages should be actionable** — tell the user what to do, not just what failed
- Run `pnpm build` before committing — CI rejects TypeScript errors

---

## Submitting a Pull Request

1. Fork and create a branch from `master`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. Make changes and build:
   ```bash
   pnpm build
   ```

3. Test manually with a dry-run review (no comments posted):
   ```bash
   GITHUB_TOKEN=$(gh auth token) node packages/reviewer/dist/cli.js review \
     --pr <id> --repo <owner/repo> --dry-run
   ```
   Or via the API endpoint:
   ```bash
   curl -X POST http://localhost:3000/api/repos/<repoId>/review \
     -H 'Content-Type: application/json' \
     -d '{"prNumber": 123, "dryRun": true}' | jq '{verdict, commentCount}'
   ```

4. Commit with a conventional message:
   ```
   <type>: <short description>
   ```
   Types: `feat` | `fix` | `refactor` | `docs` | `chore`

   Examples:
   - `feat: add Gemini LLM backend`
   - `fix: normalise Azure file paths before posting`
   - `docs: add contributing guide`

5. Push and open a PR against `master`.

6. Fill in the PR description — **what** changed, **why** it was needed, **how** to test it.

### PR Checklist

- [ ] `pnpm build` passes with no errors
- [ ] Manually tested (dry-run or otherwise)
- [ ] New provider/adapter/parser follows the existing interface pattern
- [ ] No secrets or tokens committed
- [ ] Docs / ADR updated if architecture changed

---

## Reporting Issues

Open an issue at [github.com/ivoyant-eng/AgnusAi/issues](https://github.com/ivoyant-eng/AgnusAi/issues) with:

- **What you expected** to happen
- **What actually happened** — include the full error output
- **How to reproduce** — PR URL if possible, CLI command used, provider, model
- **Environment** — OS, Node.js version, provider

---

## Questions?

Open a discussion on GitHub or reach out to [@theashishmaurya](https://github.com/theashishmaurya).
