# Rules System

The Rules System is Ryv's enterprise governance layer. Org admins define standards once — and every PR review automatically checks compliance, records evaluations, and tracks violations.

## What is a Rule?

A rule is a natural-language policy stored in the database, scoped to an organization, repository, or file path. During each review the applicable rules are injected into the LLM prompt. The LLM checks each rule and flags violations inline.

Example rules:

- _"No hardcoded secrets or API keys in source files"_
- _"All user inputs must be validated at system boundaries"_
- _"No raw card numbers (PAN) may be stored or logged"_

## Rule Lifecycle

```
Create → Enable → Enforcement on every review → Evaluation stored → Violations tracked
                                                                    → Merged-with-violation on PR close
```

Rules can also be **discovered** from historical PR patterns and promoted from suggestions.

## Scope

| Scope | Applies to |
|-------|-----------|
| `org` | All repos in the organization |
| `repo` | A specific repository only |
| `path` | Files matching a glob pattern within a repo |

More specific scopes take precedence. A `repo`-scoped rule overrides an `org`-scoped rule of the same name.

## Creating Rules

### Via the Dashboard

Navigate to **Rules** (`/app/rules`) → **New Rule**.

Fields:

| Field | Description |
|-------|-------------|
| Name | Short identifier (e.g. `no-hardcoded-secrets`) |
| Content | Full rule description — what the LLM checks for |
| Scope | `org`, `repo`, or `path` |
| Enabled | Toggle enforcement on/off without deleting |

### Via the REST API

```bash
POST /api/rules
Content-Type: application/json
Authorization: Bearer <api-key>

{
  "name": "No hardcoded secrets",
  "content": "Never commit API keys, tokens, passwords, or any credential directly in source code.",
  "scope": "org",
  "enabled": true
}
```

See the [REST API reference](/api/rest#rules) for the full CRUD surface.

## How Enforcement Works

1. At review time, the runner queries all `enabled` rules applicable to the current `(org, repo, path)`.
2. Applicable rules are injected into the review prompt as a `## Enforced Rules` section.
3. The LLM checks each rule and includes a `[Rule: <name>]` marker in any comment that violates a rule.
4. The runner persists one `rule_evaluation` row per rule (pass/fail) and one `rule_violation` row per finding.
5. When a PR is merged/closed, open violations for that PR are automatically marked `merged_with_violation`.

## How Violations Appear in PR Comments {#violations}

When the LLM detects a rule violation it emits a structured inline marker alongside the review finding. The comment body will look like:

```
Hardcoded API key detected on line 42. Secrets committed to source control are a
critical security risk — rotate this key immediately and use environment variables instead.

[Rule: no-hardcoded-secrets] [Confidence: 0.97] BLOCKER
```

- **`[Rule: <name>]`** — links the finding back to a named rule so teams can trace it in the analytics dashboard.
- **`[Confidence: X.X]`** — the LLM's self-assessed certainty for this specific finding (0.0–1.0). Comments below the `PRECISION_THRESHOLD` (default `0.7`) are filtered before posting.
- **Severity label** (`BLOCKER`, `SUGGESTION`, etc.) — optional, added when the rule content specifies a severity.

Multiple violations in one PR produce independent comments, each tagged with their own `[Rule: ...]` marker.

## What Gets Injected into the Prompt {#prompt-injection}

Given an org with three active rules, the review prompt will contain a section like:

```
## Enforced Rules

The following organizational rules MUST be checked on every file in this diff.
For any violation, cite the rule name inline using the format [Rule: <name>].

1. no-hardcoded-secrets
   Never commit API keys, tokens, passwords, or any credential directly in source code.
   Scope: org

2. require-tests
   Every new function or method must have a corresponding unit test.
   Scope: repo (payments-service)

3. no-any-typescript
   TypeScript files must not use the `any` type. Prefer specific types or unknown + type-narrowing.
   Scope: path (src/**/*.ts)
```

Rules are ordered by specificity (path > repo > org) so narrower policies appear closest to the relevant instructions.

## Rule Evaluations and Violations

Two tables persist enforcement results:

| Table | Row | When written |
|-------|-----|-------------|
| `rule_evaluations` | One row per rule per review | Every review run |
| `rule_violations` | One row per detected violation | When LLM flags a rule breach |

A violation status progresses: `open` → `resolved` (manually) or `merged_with_violation` (auto on PR close).

## Rule Discovery

Rules can be auto-suggested from your existing AGENTS.md, CLAUDE.md, or historical PR comment patterns:

```bash
POST /api/rules/discover
```

Suggestions appear in the **Suggested Rules** tab on the Dashboard. Org admins can approve or dismiss each one.

## Analytics

The Dashboard Rules page shows aggregate analytics:

- Rules fired per review (pass/fail ratio)
- Top violated rules
- Merged-with-violation count (standards bypassed in production)

CSV export available for audit trails:

```bash
GET /api/rules/analytics/export?type=merged_violations
```

## Environment Variable

| Variable | Default | Description |
|----------|---------|-------------|
| `RULES_SYSTEM_ENABLED` | `true` | Set to `false` to disable rule enforcement globally |

## Example Rules {#examples}

Below are ready-to-use rules organized by category. Copy the `content` field verbatim into the dashboard or API.

### Security

| Name | Content |
|------|---------|
| `no-hardcoded-secrets` | Never commit API keys, tokens, passwords, or any credential directly in source code. Use environment variables or a secrets manager. |
| `no-sql-injection` | All SQL queries must use parameterized queries or an ORM. String interpolation into SQL is not permitted. |
| `no-pii-logging` | PII (email addresses, phone numbers, SSNs, card numbers) must never appear in log statements. |
| `require-auth-checks` | Every HTTP route handler that accesses user data must verify authentication before proceeding. |

### Code Quality

| Name | Content |
|------|---------|
| `no-any-typescript` | TypeScript files must not use the `any` type. Prefer specific types, generics, or `unknown` with type-narrowing. |
| `no-console-log` | `console.log` and `console.error` calls must not be committed to production code. Use the structured logger instead. |
| `no-magic-numbers` | Numeric literals (other than 0 and 1) must be assigned to a named constant before use. |
| `no-TODO-in-prod` | TODO and FIXME comments must not exist in production-branch commits. Resolve or track them in the issue tracker. |

### Testing

| Name | Content |
|------|---------|
| `require-tests` | Every new public function or method must have at least one unit test covering the happy path. |
| `require-error-tests` | Functions that throw or return errors must include a test case for the error path. |

### Architecture

| Name | Content |
|------|---------|
| `no-cross-service-imports` | Services must not import directly from sibling service packages. Use shared types from the `shared` package only. |
| `no-db-in-controllers` | Controller/route handler files must not import database clients directly. All DB access must go through a service layer. |

## vs. Skills (Internal YAML Guidelines)

Ryv also has an internal **Skills** system — YAML files in `packages/reviewer/skills/` that inject file-pattern-based review guidelines into the prompt. Skills are a static, code-level mechanism for built-in defaults (security, frontend, backend patterns).

**Rules are the recommended way** to add organization-specific policies. They live in the database, can be managed without redeployment, and produce audit-traceable evaluations and violations. Skills remain active for built-in defaults and are not user-configurable.

| | Rules | Skills |
|--|-------|--------|
| Stored in | Database | YAML files on disk |
| Managed via | Dashboard / API | Code deployment |
| Scoped to | Org / Repo / Path | File patterns |
| Produces audit trail | ✓ | ✗ |
| User-configurable | ✓ | ✗ (internal only) |
