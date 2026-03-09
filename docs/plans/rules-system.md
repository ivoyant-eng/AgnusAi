# Plan: Rules System (G3)

> Priority: High (Enterprise Governance)
>
> **Status: Shipped** — see `packages/api/src/routes/rules.ts`, `packages/api/src/rules-enforcement.ts`, and `packages/docs/reference/rules.md` for current state
>
> Roadmap ref: `docs/roadmap/v3-competitive.md#G3`

## Objective
Build a governed, user-visible Rules System on top of AgnusAI's existing feedback loop so organizations can define standards once, enforce them on every PR, and track outcomes over time.

This plan targets parity with the core Qodo Rule Enforcement motion:
- Central rules management
- Suggested/discovered rules
- Automated enforcement during review
- Analytics with merged-violation visibility and export

## What We Learned From Qodo (for product parity)
From Qodo docs, the practical behavior to match is:
- Rules are first-class entities with lifecycle controls (create/edit/enable/disable/delete)
- Suggested rules are not auto-enforced; they require admin acceptance
- Rule scope supports org/repo/path-level targeting
- Rule analytics are presented for last 30 days, including merged violations and CSV export
- Onboarding imports existing rule-like files (AGENTS.md, CLAUDE.md, etc.) and generates suggestions from historical PR patterns

## Scope for AgnusAI v1
### In scope
- Rule CRUD and lifecycle
- Org/repo/path scoped enforcement
- Suggested rules pipeline (discovery + approval flow)
- Enforcement integrated into review runner
- Rule analytics (aggregate + per-rule + CSV)
- Onboarding import and initial suggestion generation

### Out of scope (v1)
- Auto-remediation/fix generation per violation
- Cross-org shared rule catalog/templates
- Full semantic conflict resolver (v1 will do practical duplicate/overlap checks)

## Target Architecture
1. Rules Discovery Agent
- Inputs: org repos, recent PR reviews/comments, accepted/rejected feedback
- Outputs: suggested rules with evidence links

2. Rules Expert Agent (Normalization + Hygiene)
- Inputs: proposed + existing active rules
- Tasks: de-duplicate, detect overlap/conflicts, assign category/severity, recommend edits
- Outputs: clean draft + conflict warnings

3. Enforcement Service
- On each review, resolve applicable rules by scope (org -> repo -> path)
- Inject resolved rule block into review prompts
- Require machine-parsable metadata in findings (`rule_id`, `rule_name`, `severity`)

4. Analytics Pipeline
- Persist rule evaluations and violations
- Compute 30-day aggregates and per-rule metrics
- CSV export endpoint for merged violations and compliance reporting

## Data Model
Add/extend:
- `rules`
  - `id`, `org_id`, `name`, `content`, `category`, `severity`, `enabled`
  - `scope_type` (`org|repo|path`), `repo_id`, `path_pattern`
  - `source` (`manual|imported|suggested`), `created_by`, timestamps
- `rule_suggestions`
  - `id`, `org_id`, generated fields, `evidence` (PR/comment refs), `status`
- `rule_violations`
  - `id`, `rule_id`, `org_id`, `repo_id`, `pr_number`, `review_id`
  - `file_path`, `line`, `status` (`open|resolved|merged_with_violation`), timestamps
- `rule_evaluations`
  - per PR x rule evaluation record to support pass-rate analytics

## API Surface
- `GET/POST /api/rules`
- `GET/PUT/DELETE /api/rules/:id`
- `POST /api/rules/:id/toggle`
- `GET /api/rules/suggestions`
- `POST /api/rules/suggestions/:id/approve`
- `DELETE /api/rules/suggestions/:id`
- `POST /api/rules/discover`
- `GET /api/rules/analytics`
- `GET /api/rules/:id/analytics`
- `GET /api/rules/analytics/export?type=merged_violations`

## Dashboard UX
- Rules table: name, category, severity, scope, source, enabled, 30d violations
- Rule editor: content + examples + scope picker (org/repo/path)
- Suggestions tab: evidence-first review, approve/dismiss
- Analytics tab:
  - Passed (no violations)
  - Detected violations
  - Merged violations
  - Top violated rules
  - Trend chart (30d)
  - CSV export button

## Rollout Plan
### Phase 0: Foundations (3-4 days)
- Finalize schema and migrations
- Define shared types for rule entities and analytics DTOs
- Add feature flag `RULES_SYSTEM_ENABLED`

Acceptance:
- migrations apply cleanly
- API compiles with typed contracts

### Phase 1: Rule CRUD + Scoping (4-5 days)
- Implement rules routes and org/repo/path resolution logic
- Build rules list/create/edit UI

Acceptance:
- admin can create and activate scoped rules
- non-admin cannot activate/modify active rules

### Phase 2: Enforcement (4-6 days)
- Inject resolved rules into review-runner prompt
- Persist `rule_evaluations` and `rule_violations`
- Render rule metadata in posted findings

Acceptance:
- every reviewed PR has evaluation records
- violations are traceable to specific rule IDs

### Phase 3: Suggestions + Onboarding (5-7 days)
- Import rules from known files during onboarding
- Discovery endpoint from historical PR feedback
- Suggestions approval flow in UI

Acceptance:
- imported + suggested rules visible in portal
- suggestions are never auto-enforced without approval

### Phase 4: Analytics + Export (3-4 days)
- Aggregate and per-rule analytics queries
- CSV export for merged violations
- 30-day dashboard cards + trend visuals

Acceptance:
- metrics reconcile with DB samples
- CSV export works for organization admins

### Phase 5: Rules Expert Hygiene (3-5 days)
- Duplicate/overlap detector (embedding + lexical checks)
- Conflict warnings before activation

Acceptance:
- warning coverage on seeded conflict scenarios
- admin can override with explicit confirmation

## KPIs
- % PRs evaluated against >=1 active rule
- violation detection rate per 100 PRs
- merged-with-violation rate (target down trend)
- suggestion acceptance rate
- stale/noisy rule rate (violated often, low actionability)

## Risks and Mitigations
- Noisy rules reduce trust
  - mitigation: suggestion approval gate + per-rule disable + analytics visibility
- Prompt bloat with many rules
  - mitigation: scope resolution + category trimming + top-N relevance for path scope
- False positives in discovery
  - mitigation: evidence-linked suggestions and mandatory human approval

## Dependencies
- Existing multi-org/auth context (org-scoped routes)
- Review runner metadata persistence
- Dashboard settings and permissions hooks

## Execution Order Recommendation
Implement G3 before full G4 rollout. Rules become a stable policy layer that specialized agents can consume in G4.

## References
- Qodo rule enforcement docs: https://docs.qodo.ai/qodo-documentation/code-review/get-started/rule-enforcement
- Qodo onboarding: https://docs.qodo.ai/qodo-documentation/code-review/get-started/rule-enforcement/onboarding
- Qodo rule generation/management: https://docs.qodo.ai/qodo-documentation/code-review/get-started/rule-enforcement/generate-and-manage-rules
- Qodo suggested rules: https://docs.qodo.ai/qodo-documentation/code-review/get-started/rule-enforcement/suggested-rules
- Qodo analytics: https://docs.qodo.ai/qodo-documentation/code-review/get-started/rule-enforcement/analytics
