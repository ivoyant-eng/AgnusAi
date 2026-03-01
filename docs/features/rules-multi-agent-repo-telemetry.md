# Rules Enforcement + Multi-Agent Review + Repo Telemetry

## Overview

This feature set adds enterprise-grade governance and observability:

1. Rules system with org/repo/path scope and enforcement during review
2. Multi-agent specialized review pipeline with judge consolidation
3. Persistent per-agent telemetry
4. Repo-specific analytics page in Dashboard
5. Merged-violation tracking when PRs are completed

## Implemented Scope

### 1) Rules System (G3)

- Rule CRUD:
  - create/edit/delete/enable/disable rules
  - scope: `org | repo | path`
- Suggested rule lifecycle:
  - discover suggestions
  - approve/dismiss suggestions
- Enforcement:
  - applicable rules resolved per review run
  - rules injected into review prompt context
  - rule evaluations and violations persisted
- Analytics:
  - aggregate analytics and per-rule analytics
  - CSV export for merged violations

### 2) Multi-Agent Review (G4)

- Parallel specialist roles:
  - `security`
  - `correctness`
  - `performance`
  - `style_maintainability`
  - `ticket_compliance` (when ticket context exists)
  - `blast_radius` (when graph context exists)
- Judge modes:
  - deterministic judge (default)
  - optional LLM judge (`JUDGE_MODE=llm`) with deterministic fallback
- Per-agent telemetry captured for each run

### 3) PR Merge Violation Status

- On PR merge/completion:
  - open `rule_violations` for that `repo_id + pr_number` are marked `merged_with_violation`

### 4) Dashboard Repo Analytics UX

- Dashboard repo rows are clickable
- New repo detail route: `/app/repos/:repoId`
- Repo detail page shows:
  - repo-level telemetry summary
  - repo settings snapshot
  - per-agent telemetry table
  - repo-only recent reviews with accepted/rejected counts

## Data Model

Added/used tables:

- `rules`
- `rule_suggestions`
- `rule_evaluations`
- `rule_violations`
- `review_agent_telemetry` (new)

`review_agent_telemetry` fields:

- `review_id`, `org_id`, `repo_id`, `pr_number`
- `agent_role`, `verdict`, `comment_count`, `duration_ms`
- `tokens_used`, `error`, `created_at`

## Runtime Configuration

### Rules

- `RULES_SYSTEM_ENABLED=true|false` (default `true`)

### Multi-agent

- `MULTI_AGENT_ENABLED=true|false` (default `false`)
- `REVIEW_MODE=single|fast|thorough|auto` (default `single`)
- `ENABLED_AGENTS=security,correctness,...` (optional override)
- `AGENT_CONCURRENCY=2` (default `2`)
- `JUDGE_ENABLED=true|false` (default `true`)
- `JUDGE_MODE=deterministic|llm` (default `deterministic`)

## API Surface

Rules:

- `GET /api/rules`
- `POST /api/rules`
- `GET /api/rules/:id`
- `PUT /api/rules/:id`
- `DELETE /api/rules/:id`
- `POST /api/rules/:id/toggle`
- `GET /api/rules/suggestions`
- `POST /api/rules/discover`
- `POST /api/rules/suggestions/:id/approve`
- `DELETE /api/rules/suggestions/:id`
- `GET /api/rules/analytics`
- `GET /api/rules/:id/analytics`
- `GET /api/rules/analytics/export?type=merged_violations`

Repo analytics:

- `GET /api/repos/:id/analytics`
- `GET /api/repos/:id/reviews`
- `GET /api/repos/:id/agent-telemetry?days=30`
- existing: `GET /api/repos/:id/feedback-metrics`
- existing: `GET /api/repos/:id/precision`

## How To Test

### 1) Build + start

Run:

```bash
pnpm --filter @agnus-ai/shared build
pnpm --filter @agnus-ai/reviewer build
pnpm --filter @agnus-ai/api build
pnpm --filter @agnus-ai/dashboard build
```

Start API/dashboard as usual (Docker or local).

### 2) Enable multi-agent + judge

Set env:

```bash
MULTI_AGENT_ENABLED=true
REVIEW_MODE=thorough
AGENT_CONCURRENCY=2
JUDGE_ENABLED=true
JUDGE_MODE=deterministic
```

Optional LLM judge test:

```bash
JUDGE_MODE=llm
```

Restart service after env changes.

### 3) Rules CRUD + enforcement

1. Create rule in Dashboard Rules page (`/app/rules`) or `POST /api/rules`
2. Trigger a review (webhook or manual review endpoint)
3. Verify DB rows:

```sql
SELECT * FROM rule_evaluations ORDER BY evaluated_at DESC LIMIT 20;
SELECT * FROM rule_violations ORDER BY detected_at DESC LIMIT 20;
```

Expected:

- one evaluation row per applicable rule per review
- violations only when findings map to an enforced rule

### 4) Multi-agent telemetry persistence

Trigger a review with `MULTI_AGENT_ENABLED=true`.

Verify:

```sql
SELECT agent_role, verdict, comment_count, duration_ms, error, created_at
FROM review_agent_telemetry
ORDER BY created_at DESC
LIMIT 50;
```

Expected:

- one row per executed agent role
- `error` populated only for failed agent runs

### 5) Repo analytics APIs

Call:

```bash
curl -s http://localhost/api/repos/<repoId>/analytics -b "<session-cookie>"
curl -s http://localhost/api/repos/<repoId>/reviews -b "<session-cookie>"
curl -s "http://localhost/api/repos/<repoId>/agent-telemetry?days=30" -b "<session-cookie>"
```

Expected:

- repo-scoped values only (org access enforced)

### 6) Dashboard repo page

1. Open `/app`
2. Click any repo row (or Analytics link)
3. Verify navigation to `/app/repos/:repoId`
4. Validate:
  - summary cards load
  - repo settings section loads
  - agent telemetry table loads
  - recent repo reviews table loads

### 7) Merged violation tracking

1. Create/keep at least one open violation for a PR
2. Complete/merge that PR in GitHub/Azure
3. Verify:

```sql
SELECT status, resolved_at
FROM rule_violations
WHERE repo_id = '<repoId>' AND pr_number = <prNumber>;
```

Expected:

- `status = 'merged_with_violation'`
- `resolved_at` populated

## Notes

- LLM judge mode is optional and guarded by `JUDGE_MODE=llm`.
- If LLM judge output is invalid/unparseable, the system falls back to deterministic judge logic.
- Repo analytics page is intentionally repo-scoped for isolation and clearer operational debugging.

