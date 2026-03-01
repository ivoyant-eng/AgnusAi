import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import {
  RULE_CATEGORIES,
  RULE_SCOPE_TYPES,
  RULE_SEVERITIES,
  RULE_SOURCES,
  RULE_SUGGESTION_STATUSES,
  RULE_VIOLATION_STATUSES,
  type RuleCategory,
  type RuleScopeType,
  type RuleSeverity,
  type RuleSource,
} from '@agnus-ai/shared'
import { requireAuth, requireOrgAdmin } from '../auth/middleware'
import type { AuthJwtClaims } from '../auth/types'

const DEFAULT_RULE_CATEGORY: RuleCategory = 'custom'
const DEFAULT_RULE_SEVERITY: RuleSeverity = 'warning'
const DEFAULT_RULE_SCOPE: RuleScopeType = 'org'

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function asRuleCategory(value: unknown): RuleCategory {
  return includes(RULE_CATEGORIES, value) ? value : DEFAULT_RULE_CATEGORY
}

function asRuleSeverity(value: unknown): RuleSeverity {
  return includes(RULE_SEVERITIES, value) ? value : DEFAULT_RULE_SEVERITY
}

function asRuleScopeType(value: unknown): RuleScopeType {
  return includes(RULE_SCOPE_TYPES, value) ? value : DEFAULT_RULE_SCOPE
}

function asRuleSource(value: unknown): RuleSource {
  return includes(RULE_SOURCES, value) ? value : 'manual'
}

function activeOrgId(req: { user: AuthJwtClaims }): string | null {
  return req.user?.activeOrgId ?? null
}

async function canReadOrg(pool: Pool, user: AuthJwtClaims, orgId: string): Promise<boolean> {
  if (user.isSystemAdmin) return true
  const { rows } = await pool.query(
    'SELECT 1 FROM org_members WHERE user_id = $1 AND org_id = $2 LIMIT 1',
    [user.id, orgId],
  )
  return rows.length > 0
}

async function resolveOrgContext(
  pool: Pool,
  user: AuthJwtClaims,
  orgIdFromRequest?: string | null,
): Promise<{ ok: true; orgId: string } | { ok: false; status: number; error: string }> {
  const orgId = orgIdFromRequest ?? activeOrgId({ user })
  if (!orgId) return { ok: false, status: 400, error: 'Active org is required' }
  if (!(await canReadOrg(pool, user, orgId))) return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true, orgId }
}

type RuleRow = {
  id: string
  org_id: string
  name: string
  content: string
  examples: string | null
  category: string
  severity: string
  enabled: boolean
  scope_type: string
  repo_id: string | null
  path_pattern: string | null
  source: string
  created_by: string | null
  created_at: string
  updated_at: string
}

function toRuleDto(row: RuleRow) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    content: row.content,
    examples: row.examples,
    category: asRuleCategory(row.category),
    severity: asRuleSeverity(row.severity),
    enabled: row.enabled,
    scopeType: asRuleScopeType(row.scope_type),
    repoId: row.repo_id,
    pathPattern: row.path_pattern,
    source: asRuleSource(row.source),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function rulesRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db

  app.get('/api/rules', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { orgId: orgIdQ, includeDisabled } = req.query as { orgId?: string; includeDisabled?: string }
    const ctx = await resolveOrgContext(pool, user, orgIdQ ?? null)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    const enabledFilter = includeDisabled === 'true' ? '' : 'AND enabled = true'
    const { rows } = await pool.query<RuleRow>(
      `SELECT id, org_id, name, content, examples, category, severity, enabled, scope_type, repo_id, path_pattern, source, created_by, created_at, updated_at
       FROM rules
       WHERE org_id = $1 ${enabledFilter}
       ORDER BY updated_at DESC`,
      [ctx.orgId],
    )
    return reply.send(rows.map(toRuleDto))
  })

  app.post('/api/rules', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const body = (req.body ?? {}) as {
      orgId?: string
      name?: string
      content?: string
      examples?: string
      category?: RuleCategory
      severity?: RuleSeverity
      scopeType?: RuleScopeType
      repoId?: string
      pathPattern?: string
      enabled?: boolean
      source?: RuleSource
    }
    const ctx = await resolveOrgContext(pool, user, body.orgId ?? null)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    if (!body.name?.trim() || !body.content?.trim()) {
      return reply.status(400).send({ error: 'name and content are required' })
    }
    const category = asRuleCategory(body.category)
    const severity = asRuleSeverity(body.severity)
    const scopeType = asRuleScopeType(body.scopeType)
    const source = asRuleSource(body.source)
    const id = crypto.randomUUID()
    const { rows } = await pool.query<RuleRow>(
      `INSERT INTO rules (
        id, org_id, name, content, examples, category, severity, enabled, scope_type, repo_id, path_pattern, source, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id, org_id, name, content, examples, category, severity, enabled, scope_type, repo_id, path_pattern, source, created_by, created_at, updated_at`,
      [
        id,
        ctx.orgId,
        body.name.trim(),
        body.content.trim(),
        body.examples?.trim() || null,
        category,
        severity,
        body.enabled ?? true,
        scopeType,
        scopeType === 'org' ? null : (body.repoId ?? null),
        scopeType === 'path' ? (body.pathPattern ?? null) : null,
        source,
        user.id,
      ],
    )
    return reply.status(201).send(toRuleDto(rows[0]))
  })

  app.get('/api/rules/analytics', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { orgId: orgIdQ } = req.query as { orgId?: string }
    const ctx = await resolveOrgContext(pool, user, orgIdQ ?? null)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })

    const totalRules = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM rules WHERE org_id = $1', [ctx.orgId])
    const enabledRules = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM rules WHERE org_id = $1 AND enabled = true', [ctx.orgId])
    const passed = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rule_evaluations
       WHERE org_id = $1 AND passed = true AND evaluated_at >= NOW() - INTERVAL '30 days'`,
      [ctx.orgId],
    )
    const detected = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rule_violations
       WHERE org_id = $1 AND detected_at >= NOW() - INTERVAL '30 days'`,
      [ctx.orgId],
    )
    const merged = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rule_violations
       WHERE org_id = $1 AND status = 'merged_with_violation' AND detected_at >= NOW() - INTERVAL '30 days'`,
      [ctx.orgId],
    )
    const top = await pool.query<{
      rule_id: string
      rule_name: string
      violation_count: number
      merged_count: number
    }>(
      `SELECT rv.rule_id, r.name AS rule_name,
              COUNT(*)::int AS violation_count,
              COUNT(*) FILTER (WHERE rv.status = 'merged_with_violation')::int AS merged_count
       FROM rule_violations rv
       JOIN rules r ON r.id = rv.rule_id
       WHERE rv.org_id = $1 AND rv.detected_at >= NOW() - INTERVAL '30 days'
       GROUP BY rv.rule_id, r.name
       ORDER BY violation_count DESC
       LIMIT 10`,
      [ctx.orgId],
    )
    const detectedN = parseInt(detected.rows[0]?.count ?? '0', 10)
    const mergedN = parseInt(merged.rows[0]?.count ?? '0', 10)
    return reply.send({
      totalRules: parseInt(totalRules.rows[0]?.count ?? '0', 10),
      enabledRules: parseInt(enabledRules.rows[0]?.count ?? '0', 10),
      passedNoViolations: parseInt(passed.rows[0]?.count ?? '0', 10),
      detectedViolations: detectedN,
      mergedViolations: mergedN,
      mergeViolationRate: detectedN > 0 ? +(mergedN / detectedN).toFixed(4) : 0,
      topViolatedRules: top.rows.map(r => ({
        ruleId: r.rule_id,
        ruleName: r.rule_name,
        violationCount: r.violation_count,
        mergedCount: r.merged_count,
      })),
    })
  })

  app.get('/api/rules/analytics/export', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { orgId: orgIdQ, type } = req.query as { orgId?: string; type?: string }
    const ctx = await resolveOrgContext(pool, user, orgIdQ ?? null)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    if (type !== 'merged_violations') {
      return reply.status(400).send({ error: 'type must be merged_violations' })
    }
    const { rows } = await pool.query<{
      rule_name: string
      repo_id: string
      pr_number: number
      file_path: string | null
      line_number: number | null
      detected_at: string
    }>(
      `SELECT r.name AS rule_name, rv.repo_id, rv.pr_number, rv.file_path, rv.line_number, rv.detected_at
       FROM rule_violations rv
       JOIN rules r ON r.id = rv.rule_id
       WHERE rv.org_id = $1
         AND rv.status = 'merged_with_violation'
         AND rv.detected_at >= NOW() - INTERVAL '30 days'
       ORDER BY rv.detected_at DESC`,
      [ctx.orgId],
    )
    const lines = ['rule_name,repo_id,pr_number,file_path,line_number,detected_at']
    for (const row of rows) {
      const values = [
        row.rule_name,
        row.repo_id,
        String(row.pr_number),
        row.file_path ?? '',
        row.line_number == null ? '' : String(row.line_number),
        row.detected_at,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`)
      lines.push(values.join(','))
    }
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', 'attachment; filename=\"merged_violations.csv\"')
    return reply.send(lines.join('\n'))
  })

  app.get('/api/rules/suggestions', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { orgId: orgIdQ, status } = req.query as { orgId?: string; status?: string }
    const ctx = await resolveOrgContext(pool, user, orgIdQ ?? null)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    const statusFilter = includes(RULE_SUGGESTION_STATUSES, status)
      ? 'AND status = $2'
      : ''
    const params = includes(RULE_SUGGESTION_STATUSES, status) ? [ctx.orgId, status] : [ctx.orgId]
    const { rows } = await pool.query(
      `SELECT id, org_id, name, content, examples, category, severity, suggested_scope_type, suggested_repo_id, suggested_path_pattern, evidence, source_count, status, created_at, updated_at
       FROM rule_suggestions
       WHERE org_id = $1 ${statusFilter}
       ORDER BY created_at DESC`,
      params,
    )
    return reply.send(rows.map((row: any) => ({
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      content: row.content,
      examples: row.examples,
      category: asRuleCategory(row.category),
      severity: asRuleSeverity(row.severity),
      suggestedScopeType: asRuleScopeType(row.suggested_scope_type),
      suggestedRepoId: row.suggested_repo_id,
      suggestedPathPattern: row.suggested_path_pattern,
      evidence: row.evidence,
      sourceCount: row.source_count ?? 0,
      status: includes(RULE_SUGGESTION_STATUSES, row.status) ? row.status : 'pending',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })))
  })

  app.post('/api/rules/discover', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const body = (req.body ?? {}) as { orgId?: string }
    const ctx = await resolveOrgContext(pool, user, body.orgId ?? null)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })

    // Lightweight v1 discovery: group recurring accepted comments and create pending suggestions.
    const recurring = await pool.query<{
      body_key: string
      source_count: number
      sample_body: string
    }>(
      `SELECT
         LOWER(TRIM(REGEXP_REPLACE(rc.body, '\\s+', ' ', 'g'))) AS body_key,
         COUNT(*)::int AS source_count,
         MIN(rc.body) AS sample_body
       FROM review_feedback rf
       JOIN review_comments rc ON rc.id = rf.comment_id
       JOIN repos r ON r.repo_id = rc.repo_id
       WHERE rf.signal = 'accepted'
         AND r.org_id = $1
         AND COALESCE(rc.body, '') <> ''
       GROUP BY body_key
       HAVING COUNT(*) >= 3
       ORDER BY source_count DESC
       LIMIT 25`,
      [ctx.orgId],
    )

    let created = 0
    for (const row of recurring.rows) {
      const exists = await pool.query(
        `SELECT 1 FROM rule_suggestions
         WHERE org_id = $1 AND LOWER(TRIM(content)) = LOWER(TRIM($2)) AND status = 'pending'
         LIMIT 1`,
        [ctx.orgId, row.sample_body],
      )
      if (exists.rows.length > 0) continue
      await pool.query(
        `INSERT INTO rule_suggestions (
          id, org_id, name, content, category, severity, suggested_scope_type, source_count, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
        [
          crypto.randomUUID(),
          ctx.orgId,
          `Suggested rule (${created + 1})`,
          row.sample_body,
          DEFAULT_RULE_CATEGORY,
          DEFAULT_RULE_SEVERITY,
          DEFAULT_RULE_SCOPE,
          row.source_count,
        ],
      )
      created += 1
    }
    return reply.send({ ok: true, created })
  })

  app.post('/api/rules/suggestions/:id/approve', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as {
      orgId?: string
      scopeType?: RuleScopeType
      repoId?: string
      pathPattern?: string
      enabled?: boolean
    }
    const ctx = await resolveOrgContext(pool, user, body.orgId ?? null)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    const suggestion = await pool.query(
      `SELECT id, org_id, name, content, examples, category, severity, suggested_scope_type, suggested_repo_id, suggested_path_pattern, status
       FROM rule_suggestions WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [id, ctx.orgId],
    )
    if (suggestion.rows.length === 0) return reply.status(404).send({ error: 'Suggestion not found' })
    if (suggestion.rows[0].status !== 'pending') {
      return reply.status(400).send({ error: 'Suggestion already processed' })
    }
    const scopeType = asRuleScopeType(body.scopeType ?? suggestion.rows[0].suggested_scope_type)
    const { rows } = await pool.query<RuleRow>(
      `INSERT INTO rules (
         id, org_id, name, content, examples, category, severity, enabled, scope_type, repo_id, path_pattern, source, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'suggested',$12)
       RETURNING id, org_id, name, content, examples, category, severity, enabled, scope_type, repo_id, path_pattern, source, created_by, created_at, updated_at`,
      [
        crypto.randomUUID(),
        ctx.orgId,
        suggestion.rows[0].name,
        suggestion.rows[0].content,
        suggestion.rows[0].examples,
        asRuleCategory(suggestion.rows[0].category),
        asRuleSeverity(suggestion.rows[0].severity),
        body.enabled ?? true,
        scopeType,
        scopeType === 'org' ? null : (body.repoId ?? suggestion.rows[0].suggested_repo_id ?? null),
        scopeType === 'path' ? (body.pathPattern ?? suggestion.rows[0].suggested_path_pattern ?? null) : null,
        user.id,
      ],
    )
    await pool.query(
      `UPDATE rule_suggestions
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND org_id = $2`,
      [id, ctx.orgId],
    )
    return reply.send({ ok: true, rule: toRuleDto(rows[0]) })
  })

  app.delete('/api/rules/suggestions/:id', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { id } = req.params as { id: string }
    const { orgId: orgIdQ } = req.query as { orgId?: string }
    const ctx = await resolveOrgContext(pool, user, orgIdQ ?? null)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    await pool.query(
      `UPDATE rule_suggestions
       SET status = 'dismissed', updated_at = NOW()
       WHERE id = $1 AND org_id = $2`,
      [id, ctx.orgId],
    )
    return reply.status(204).send()
  })

  app.get('/api/rules/:id/analytics', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { id } = req.params as { id: string }
    const rule = await pool.query<{ id: string; org_id: string; name: string }>(
      'SELECT id, org_id, name FROM rules WHERE id = $1 LIMIT 1',
      [id],
    )
    if (rule.rows.length === 0) return reply.status(404).send({ error: 'Rule not found' })
    if (!(await canReadOrg(pool, user, rule.rows[0].org_id))) {
      return reply.status(403).send({ error: 'Forbidden' })
    }
    const evaluated = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rule_evaluations
       WHERE rule_id = $1 AND evaluated_at >= NOW() - INTERVAL '30 days'`,
      [id],
    )
    const violations = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rule_violations
       WHERE rule_id = $1 AND detected_at >= NOW() - INTERVAL '30 days'`,
      [id],
    )
    const resolved = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rule_violations
       WHERE rule_id = $1 AND status = 'resolved' AND detected_at >= NOW() - INTERVAL '30 days'`,
      [id],
    )
    const merged = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rule_violations
       WHERE rule_id = $1 AND status = 'merged_with_violation' AND detected_at >= NOW() - INTERVAL '30 days'`,
      [id],
    )
    const trend = await pool.query<{ week: string; violations: number }>(
      `SELECT DATE_TRUNC('week', detected_at)::date::text AS week, COUNT(*)::int AS violations
       FROM rule_violations
       WHERE rule_id = $1 AND detected_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE_TRUNC('week', detected_at)
       ORDER BY week ASC`,
      [id],
    )
    const totalEvaluated = parseInt(evaluated.rows[0]?.count ?? '0', 10)
    const totalViolations = parseInt(violations.rows[0]?.count ?? '0', 10)
    const complianceRate = totalEvaluated > 0 ? +((totalEvaluated - totalViolations) / totalEvaluated).toFixed(4) : 0
    return reply.send({
      ruleId: rule.rows[0].id,
      ruleName: rule.rows[0].name,
      totalPRsEvaluated: totalEvaluated,
      violationsDetected: totalViolations,
      violationsResolved: parseInt(resolved.rows[0]?.count ?? '0', 10),
      violationsMerged: parseInt(merged.rows[0]?.count ?? '0', 10),
      complianceRate,
      weeklyTrend: trend.rows,
    })
  })

  app.get('/api/rules/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { id } = req.params as { id: string }
    const { rows } = await pool.query<RuleRow>(
      `SELECT id, org_id, name, content, examples, category, severity, enabled, scope_type, repo_id, path_pattern, source, created_by, created_at, updated_at
       FROM rules WHERE id = $1 LIMIT 1`,
      [id],
    )
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'Rule not found' })
    if (!(await canReadOrg(pool, user, row.org_id))) return reply.status(403).send({ error: 'Forbidden' })
    return reply.send(toRuleDto(row))
  })

  app.put('/api/rules/:id', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as {
      name?: string
      content?: string
      examples?: string
      category?: RuleCategory
      severity?: RuleSeverity
      enabled?: boolean
      scopeType?: RuleScopeType
      repoId?: string | null
      pathPattern?: string | null
    }
    const current = await pool.query<{ org_id: string }>('SELECT org_id FROM rules WHERE id = $1 LIMIT 1', [id])
    if (current.rows.length === 0) return reply.status(404).send({ error: 'Rule not found' })
    const ctx = await resolveOrgContext(pool, user, current.rows[0].org_id)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    const scopeType = asRuleScopeType(body.scopeType)
    const { rows } = await pool.query<RuleRow>(
      `UPDATE rules
       SET name = COALESCE($2, name),
           content = COALESCE($3, content),
           examples = COALESCE($4, examples),
           category = COALESCE($5, category),
           severity = COALESCE($6, severity),
           enabled = COALESCE($7, enabled),
           scope_type = COALESCE($8, scope_type),
           repo_id = CASE WHEN COALESCE($8, scope_type) = 'org' THEN NULL ELSE COALESCE($9, repo_id) END,
           path_pattern = CASE WHEN COALESCE($8, scope_type) = 'path' THEN COALESCE($10, path_pattern) ELSE NULL END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, org_id, name, content, examples, category, severity, enabled, scope_type, repo_id, path_pattern, source, created_by, created_at, updated_at`,
      [
        id,
        body.name?.trim(),
        body.content?.trim(),
        body.examples?.trim(),
        includes(RULE_CATEGORIES, body.category) ? body.category : null,
        includes(RULE_SEVERITIES, body.severity) ? body.severity : null,
        typeof body.enabled === 'boolean' ? body.enabled : null,
        body.scopeType ? scopeType : null,
        body.repoId ?? null,
        body.pathPattern ?? null,
      ],
    )
    return reply.send(toRuleDto(rows[0]))
  })

  app.post('/api/rules/:id/toggle', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { id } = req.params as { id: string }
    const { enabled } = (req.body ?? {}) as { enabled?: boolean }
    if (typeof enabled !== 'boolean') return reply.status(400).send({ error: 'enabled must be boolean' })
    const current = await pool.query<{ org_id: string }>('SELECT org_id FROM rules WHERE id = $1 LIMIT 1', [id])
    if (current.rows.length === 0) return reply.status(404).send({ error: 'Rule not found' })
    const ctx = await resolveOrgContext(pool, user, current.rows[0].org_id)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    await pool.query('UPDATE rules SET enabled = $2, updated_at = NOW() WHERE id = $1', [id, enabled])
    return reply.send({ ok: true, id, enabled })
  })

  app.delete('/api/rules/:id', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { id } = req.params as { id: string }
    const current = await pool.query<{ org_id: string }>('SELECT org_id FROM rules WHERE id = $1 LIMIT 1', [id])
    if (current.rows.length === 0) return reply.status(404).send({ error: 'Rule not found' })
    const ctx = await resolveOrgContext(pool, user, current.rows[0].org_id)
    if (!ctx.ok) return reply.status(ctx.status).send({ error: ctx.error })
    await pool.query('DELETE FROM rules WHERE id = $1', [id])
    return reply.status(204).send()
  })
}
