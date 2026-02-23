# Skills System

Skills allow you to inject custom review guidelines into the LLM prompt based on which files changed in the PR.

## What is a Skill?

A skill is a markdown file with a YAML frontmatter header that specifies which file patterns it applies to. When a PR touches files matching those patterns, the skill's content is appended to the review prompt.

## Skill File Format

```markdown
---
name: Frontend Components
description: Review guidelines for React components
patterns:
  - "components/**"
  - "pages/**"
  - "app/**/*.tsx"
---

## Frontend Review Guidelines

- Check that components are properly memoized when receiving object/array props
- Verify that useEffect cleanup functions are present when subscribing to external events
- Ensure that loading and error states are handled
- Check for missing `key` props in list rendering
```

## Built-in Skills

AgnusAI ships with three built-in skills in `packages/reviewer/skills/`:

| Skill | Patterns | Focus |
|-------|----------|-------|
| `default` | `**/*` | General code quality, security, performance |
| `security` | `**/*.ts`, `**/*.js`, `**/auth/**`, `**/api/**` | Auth, injection, sensitive data exposure |
| `frontend` | `**/*.tsx`, `**/*.jsx`, `components/**` | React patterns, accessibility, bundle size |

## Custom Skills

Create a `skills/` directory in your project root or any parent directory. Any `.md` files there with valid YAML frontmatter are automatically discovered.

Example skill for a Next.js API route:

```markdown
---
name: API Routes
description: Review guidelines for Next.js API routes
patterns:
  - "app/api/**"
  - "pages/api/**"
---

## API Route Guidelines

- Validate all request body parameters before use
- Return appropriate HTTP status codes (400 for validation errors, 401 for auth, 403 for authorization)
- Never log sensitive values (tokens, passwords, PII)
- Ensure all async operations are properly awaited
- Add rate limiting comments where missing
```

## Skill Discovery

Skills are loaded from the `skills/` directory configured via `config.skills.path`. The CLI defaults to the `skills/` folder in `packages/reviewer`. The API server uses the same path.

Skills are matched per-PR: a skill is included only if at least one changed file matches any of its patterns. This keeps prompts focused.

## Skills and Graph Context

Skills and graph context are both injected into the same prompt. Skills come first (review guidelines), followed by the diff, followed by the `## Codebase Context` section (graph context).
