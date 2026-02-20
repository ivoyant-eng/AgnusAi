# Skills

## Overview

Skills define focused review behaviour for specific file types or code domains. They are Markdown files with YAML front matter, loaded from `~/.pr-review/skills/` (or a custom path from `skills.path` in config). Matched skill content is injected directly into the LLM review prompt.

## Skill File Format

```markdown
---
name: Security Review
description: Review for security vulnerabilities and authentication issues
trigger:
  - "**/*.ts"
  - "**/api/**"
priority: high
---

# Security Review Guidelines

## What to Check
- Input validation on all user-supplied data
- Authentication and authorisation on every endpoint
- SQL/NoSQL injection, XSS, CSRF vectors
- Secrets or credentials hardcoded in code
- Unsafe use of `eval`, `exec`, or dynamic code
```

### Front Matter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `description` | No | One-line description |
| `trigger` | Yes | Glob patterns — skill is applied when any changed file matches |
| `priority` | No | `high` / `medium` / `low` — affects injection order |

## Built-in Skills

| Skill | Triggers | Focus |
|-------|----------|-------|
| `default` | `**/*` | General correctness, patterns, best practices |
| `security` | `**/*.ts`, `**/api/**` | Vulnerabilities, auth, input validation |
| `frontend` | `**/*.tsx`, `**/*.css` | React patterns, a11y, performance |
| `backend` | `**/api/**`, `**/*.go` | API design, database, reliability |

Built-in skills live in `skills/` at the repo root.

## How Skills Are Selected

`SkillLoader` in `src/skills/loader.ts`:

1. Reads all `SKILL.md` files from the configured skills directory
2. For each skill, checks if any changed file path matches any trigger glob
3. Matched skills are collected and sorted by priority
4. All matched skill contents are concatenated and injected into the prompt under `## Review Skills Applied`

If no skills match, the `default` skill is applied.

## Creating a Custom Skill

```bash
mkdir -p ~/.pr-review/skills/my-team-rules
cat > ~/.pr-review/skills/my-team-rules/SKILL.md << 'EOF'
---
name: My Team Rules
description: Enforce our internal coding standards
trigger:
  - "**/*.ts"
  - "src/**/*.js"
priority: high
---

# My Team Rules

## Standards
- No `any` types
- All public functions must have JSDoc
- Max 50 lines per function
- Use Result types instead of throwing exceptions
EOF
```

Then use it:

```bash
node dist/cli.js review --pr 123 --repo owner/repo --skill my-team-rules
```

## Using Skills in CI

```yaml
- name: Run Security Review
  run: |
    node dist/cli.js review \
      --pr ${{ github.event.pull_request.number }} \
      --repo ${{ github.repository }} \
      --skill security
```
