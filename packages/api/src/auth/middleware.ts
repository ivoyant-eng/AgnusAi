import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import {
  SYSTEM_SERVICE_USER,
  coerceOrgRole,
  coerceNullableOrgRole,
  coerceUserRole,
  type AuthJwtClaims,
} from './types'
import { buildAbilityFor } from './ability'

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Allow service-to-service calls via Authorization: Bearer <api_key>
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    // Check env var (fast path)
    if (process.env.API_KEY && token === process.env.API_KEY) {
      ;(req as FastifyRequest & { user: AuthJwtClaims }).user = SYSTEM_SERVICE_USER
      return
    }
    // Check DB-stored key
    try {
      const db = (req.server as { db: Pool }).db
      const { rows } = await db.query(
        'SELECT api_key FROM system_api_keys WHERE id = 1',
      )
      if (rows[0]?.api_key === token) {
        ;(req as FastifyRequest & { user: AuthJwtClaims }).user = SYSTEM_SERVICE_USER
        return
      }
    } catch { /* DB not ready — fall through to JWT */ }
  }
  try {
    await req.jwtVerify()
    const jwtUser = req.user as AuthJwtClaims
    const db = (req.server as { db: Pool }).db
    jwtUser.role = coerceUserRole(jwtUser.role, 'member')
    jwtUser.activeOrgRole = coerceNullableOrgRole(jwtUser.activeOrgRole)
    if (jwtUser?.id && db && typeof jwtUser?.isSystemAdmin !== 'boolean') {
      const sys = await db.query<{ is_system_admin: boolean }>(
        'SELECT is_system_admin FROM users WHERE id = $1 LIMIT 1',
        [jwtUser.id],
      )
      jwtUser.isSystemAdmin = Boolean(sys.rows[0]?.is_system_admin)
    }
    // Backward-compatible enrichment for old tokens: resolve active org from memberships
    if (!jwtUser?.activeOrgId && jwtUser?.id && db) {
      const { rows } = await db.query(
        `SELECT om.org_id, om.role
         FROM org_members om
         WHERE om.user_id = $1
         ORDER BY om.joined_at ASC
         LIMIT 1`,
        [jwtUser.id],
      )
      if (rows[0]) {
        jwtUser.activeOrgId = rows[0].org_id
        jwtUser.activeOrgRole = coerceOrgRole(rows[0].role, 'member')
      }
    }
    // Guard against stale session tokens that reference an org the user no longer belongs to.
    if (jwtUser?.activeOrgId && jwtUser?.id && db && !jwtUser.isSystemAdmin) {
      const membership = await db.query<{ role: string }>(
        'SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2 LIMIT 1',
        [jwtUser.id, jwtUser.activeOrgId],
      )
      if (membership.rows.length === 0) {
        const fallback = await db.query<{ org_id: string; role: string }>(
          `SELECT org_id, role
           FROM org_members
           WHERE user_id = $1
           ORDER BY joined_at ASC
           LIMIT 1`,
          [jwtUser.id],
        )
        jwtUser.activeOrgId = fallback.rows[0]?.org_id ?? null
        jwtUser.activeOrgRole = fallback.rows[0] ? coerceOrgRole(fallback.rows[0].role, 'member') : null
      }
    }
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
    return
  }
  const user = req.user as AuthJwtClaims
  const ability = buildAbilityFor(user)
  if (!ability.can('manage', 'System')) {
    reply.status(403).send({ error: 'Forbidden' })
    return
  }
}

export async function requireOrgAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
    return
  }
  const user = req.user as AuthJwtClaims
  const ability = buildAbilityFor(user)
  if (ability.can('update', 'Org')) return
  const orgKey = (req.params as any)?.orgKey as string | undefined
  if (orgKey) {
    const db = (req.server as { db: Pool }).db
    const { rows } = await db.query(
      `SELECT 1
       FROM org_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND o.slug = $2 AND om.role = 'admin'
       LIMIT 1`,
      [user?.id, orgKey],
    )
    if (rows.length === 0) {
      reply.status(403).send({ error: 'Org admin required' })
      return
    }
    return
  }
  if (coerceOrgRole(user?.activeOrgRole, 'member') !== 'admin') {
    reply.status(403).send({ error: 'Org admin required' })
    return
  }
}
