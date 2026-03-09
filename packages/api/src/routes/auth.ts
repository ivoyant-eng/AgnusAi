import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { requireAuth, requireAdmin, requireOrgAdmin } from '../auth/middleware'
import {
  coerceOrgRole,
  coerceUserRole,
  isOrgRole,
  type AuthJwtClaims,
  type OrgRole,
  type UserRole,
} from '../auth/types'

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'org'
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

export function isValidSlug(raw: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)
}

export async function findAvailableSlug(pool: Pool, baseSlug: string): Promise<string> {
  let candidate = baseSlug
  let suffix = 2
  while (true) {
    const exists = await pool.query('SELECT 1 FROM organizations WHERE LOWER(slug) = LOWER($1) LIMIT 1', [candidate])
    if (exists.rows.length === 0) return candidate
    candidate = `${baseSlug}-${suffix}`
    suffix += 1
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db
  const authRateMax = parseInt(process.env.RATE_LIMIT_AUTH_MAX ?? '20', 10)
  const authRateWindow = process.env.RATE_LIMIT_AUTH_WINDOW ?? '1 minute'
  const signupRateMax = parseInt(process.env.RATE_LIMIT_SIGNUP_MAX ?? '5', 10)
  const signupRateWindow = process.env.RATE_LIMIT_SIGNUP_WINDOW ?? '10 minutes'
  const checkOrgRateMax = parseInt(process.env.RATE_LIMIT_CHECK_ORG_MAX ?? '20', 10)
  const checkOrgRateWindow = process.env.RATE_LIMIT_CHECK_ORG_WINDOW ?? '1 minute'

  const authRateLimit = {
    max: Number.isFinite(authRateMax) && authRateMax > 0 ? authRateMax : 20,
    timeWindow: authRateWindow,
  }
  const signupRateLimit = {
    max: Number.isFinite(signupRateMax) && signupRateMax > 0 ? signupRateMax : 5,
    timeWindow: signupRateWindow,
  }
  const checkOrgRateLimit = {
    max: Number.isFinite(checkOrgRateMax) && checkOrgRateMax > 0 ? checkOrgRateMax : 20,
    timeWindow: checkOrgRateWindow,
  }

  /**
   * POST /api/auth/login — verify email + password, set httpOnly cookie
   */
  app.post('/api/auth/login', { config: { rateLimit: authRateLimit } }, async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' })
    }
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) {
      return reply.status(400).send({ error: 'email and password are required' })
    }

    const { rows } = await pool.query<{
      id: string; email: string; password_hash: string; role: UserRole | string; is_system_admin: boolean
    }>('SELECT id, email, password_hash, role, is_system_admin FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [normalizedEmail])

    const user = rows[0]
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const orgRes = await pool.query<{ org_id: string; role: OrgRole | string; slug: string; name: string }>(
      `SELECT om.org_id, om.role, o.slug, o.name
       FROM org_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1
       ORDER BY om.joined_at ASC`,
      [user.id],
    )
    const firstOrg = orgRes.rows[0]
    const token = app.jwt.sign({
      id: user.id,
      email: user.email,
      role: coerceUserRole(user.role, 'member'),
      isSystemAdmin: Boolean(user.is_system_admin),
      activeOrgId: firstOrg?.org_id ?? null,
      activeOrgRole: firstOrg ? coerceOrgRole(firstOrg.role, 'member') : null,
    })
    reply.setCookie('agnus_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      // secure: true — uncomment when running behind HTTPS
    })
    return reply.send({ ok: true })
  })

  /**
   * POST /api/auth/logout — clear cookie
   */
  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('agnus_session', { path: '/' })
    return reply.send({ ok: true })
  })

  /**
   * GET /api/auth/me — return current user info
   */
  app.get('/api/auth/me', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { rows } = await pool.query<{ org_id: string; role: OrgRole | string; slug: string; name: string }>(
      `SELECT om.org_id, om.role, o.slug, o.name
       FROM org_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1
       ORDER BY o.name ASC`,
      [user.id],
    )
    return reply.send({
      id: user.id,
      email: user.email,
      role: coerceUserRole(user.role, 'member'),
      isSystemAdmin: Boolean(user.isSystemAdmin),
      activeOrgId: user.activeOrgId ?? null,
      activeOrgRole: user.activeOrgRole ? coerceOrgRole(user.activeOrgRole, 'member') : null,
      orgs: rows.map(r => ({ orgId: r.org_id, slug: r.slug, name: r.name, role: coerceOrgRole(r.role, 'member') })),
    })
  })

  app.post('/api/auth/switch-org', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user as AuthJwtClaims
    const { orgId } = req.body as { orgId?: string }
    if (!orgId) return reply.status(400).send({ error: 'orgId is required' })

    const { rows } = await pool.query<{ role: OrgRole | string }>(
      'SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2',
      [user.id, orgId],
    )
    if (rows.length === 0 && !user.isSystemAdmin) {
      return reply.status(403).send({ error: 'Not a member of this org' })
    }
    const activeOrgRole = rows[0] ? coerceOrgRole(rows[0].role, 'member') : 'admin'
    const token = app.jwt.sign({
      id: user.id,
      email: user.email,
      role: coerceUserRole(user.role, 'member'),
      isSystemAdmin: Boolean(user.isSystemAdmin),
      activeOrgId: orgId,
      activeOrgRole,
    })
    reply.setCookie('agnus_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    return reply.send({ ok: true })
  })

  /**
   * GET /api/auth/check-org — check org name/slug availability (public)
   */
  app.get('/api/auth/check-org', { config: { rateLimit: checkOrgRateLimit } }, async (req, reply) => {
    const { name, slug } = req.query as { name?: string; slug?: string }
    const normalizedName = (name ?? '').trim()
    const rawSlug = (slug ?? '').trim()

    const nameStatus = {
      valid: normalizedName.length > 0,
      available: true,
      message: normalizedName.length > 0 ? 'Available' : 'Name is required',
    }
    if (normalizedName) {
      const existingName = await pool.query('SELECT 1 FROM organizations WHERE LOWER(name) = LOWER($1) LIMIT 1', [normalizedName])
      if (existingName.rows.length > 0) {
        nameStatus.available = false
        nameStatus.message = 'Organization name already exists'
      }
    }

    const baseSlug = rawSlug ? rawSlug.toLowerCase() : (normalizedName ? slugify(normalizedName) : '')
    const slugStatus = {
      valid: baseSlug.length > 0,
      available: true,
      message: baseSlug.length > 0 ? 'Available' : 'Slug unavailable',
      value: baseSlug,
      suggested: baseSlug,
    }

    if (rawSlug) {
      if (/\s/.test(rawSlug)) {
        slugStatus.valid = false
        slugStatus.available = false
        slugStatus.message = 'Slug cannot contain spaces'
      } else if (!isValidSlug(baseSlug)) {
        slugStatus.valid = false
        slugStatus.available = false
        slugStatus.message = 'Use lowercase letters, numbers, and hyphens only'
      }
    }

    if (slugStatus.valid && baseSlug) {
      const existingSlug = await pool.query('SELECT 1 FROM organizations WHERE LOWER(slug) = LOWER($1) LIMIT 1', [baseSlug])
      if (existingSlug.rows.length > 0) {
        slugStatus.available = false
        slugStatus.message = 'Organization slug already exists'
      }
      slugStatus.suggested = rawSlug ? baseSlug : await findAvailableSlug(pool, baseSlug)
    }

    return reply.send({
      ok: true,
      name: nameStatus,
      slug: slugStatus,
    })
  })

  /**
   * POST /api/auth/signup — create user + org + membership (admin)
   */
  app.post('/api/auth/signup', { config: { rateLimit: signupRateLimit } }, async (req, reply) => {
    const { email, password, orgName, orgSlug } = req.body as {
      email?: string; password?: string; orgName?: string; orgSlug?: string
    }
    if (!email || !password || !orgName) {
      return reply.status(400).send({ error: 'email, password, orgName are required' })
    }
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) {
      return reply.status(400).send({ error: 'email, password, orgName are required' })
    }
    const normalizedOrgName = orgName.trim()
    let slug: string
    const hasCustomSlug = Boolean(orgSlug && orgSlug.trim())
    if (hasCustomSlug) {
      const rawSlug = (orgSlug ?? '').trim()
      if (/\s/.test(rawSlug)) {
        return reply.status(400).send({ error: 'Organization slug cannot contain spaces' })
      }
      const normalizedInput = rawSlug.toLowerCase()
      if (!isValidSlug(normalizedInput)) {
        return reply.status(400).send({ error: 'Organization slug can only contain lowercase letters, numbers, and hyphens' })
      }
      slug = normalizedInput
    } else {
      slug = slugify(normalizedOrgName)
    }
    if (!normalizedOrgName) {
      return reply.status(400).send({ error: 'orgName is required' })
    }

    const existingUser = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail])
    if (existingUser.rows.length > 0) return reply.status(409).send({ error: 'Email already exists' })
    if (hasCustomSlug) {
      const existingSlug = await pool.query('SELECT 1 FROM organizations WHERE LOWER(slug) = LOWER($1)', [slug])
      if (existingSlug.rows.length > 0) return reply.status(409).send({ error: 'Organization slug already exists' })
    } else {
      slug = await findAvailableSlug(pool, slug)
    }
    const existingName = await pool.query('SELECT 1 FROM organizations WHERE LOWER(name) = LOWER($1)', [normalizedOrgName])
    if (existingName.rows.length > 0) return reply.status(409).send({ error: 'Organization name already exists' })

    const userId = crypto.randomUUID()
    const orgId = crypto.randomUUID()
    const hash = await bcrypt.hash(password, 10)
    await pool.query('BEGIN')
    try {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, role)
         VALUES ($1, $2, $3, 'member')`,
        [userId, normalizedEmail, hash],
      )
      await pool.query(
        `INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)`,
        [orgId, slug, normalizedOrgName],
      )
      await pool.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'admin')`,
        [orgId, userId],
      )
      const webhookSecret = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO org_webhook_secrets (id, org_id, platform, secret)
         VALUES ($1, $2, 'github', $3), ($4, $2, 'azure', $3)
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), orgId, webhookSecret, crypto.randomUUID()],
      )
      await pool.query('COMMIT')
    } catch (e) {
      await pool.query('ROLLBACK')
      throw e
    }

    const token = app.jwt.sign({
      id: userId,
      email: normalizedEmail,
      role: 'member',
      isSystemAdmin: false,
      activeOrgId: orgId,
      activeOrgRole: 'admin',
    })
    reply.setCookie('agnus_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    return reply.send({ ok: true, org: { id: orgId, slug, name: normalizedOrgName } })
  })

  /**
   * POST /api/auth/invite — admin generates a one-time invite token
   */
  app.post('/api/auth/invite', { preHandler: [requireOrgAdmin] }, async (req, reply) => {
    const admin = req.user as AuthJwtClaims
    const { email, orgId, role } = (req.body as { email?: string; orgId?: string; role?: 'admin' | 'member' }) ?? {}
    const targetOrgId = orgId || admin.activeOrgId
    if (!targetOrgId) return reply.status(400).send({ error: 'orgId is required' })

    const token = crypto.randomBytes(32).toString('hex')
    const normalizedInviteEmail = email ? normalizeEmail(email) : null
    await pool.query(
      `INSERT INTO invites (token, email, created_by, org_id, org_role) VALUES ($1, $2, $3, $4, $5)`,
      [token, normalizedInviteEmail, admin.id, targetOrgId, isOrgRole(role) ? role : 'member'],
    )

    const origin = req.headers.origin ?? `${req.protocol}://${req.hostname}`
    const url = `${origin}/login?invite=${token}`
    return reply.send({ token, url })
  })

  /**
   * GET /api/auth/api-key — return masked preview of current API key (admin only)
   */
  app.get('/api/auth/api-key', { preHandler: [requireAdmin] }, async (_req, reply) => {
    const { rows } = await pool.query<{ api_key: string; created_at: string }>(
      'SELECT api_key, created_at FROM system_api_keys WHERE id = 1',
    )
    if (!rows[0]) return reply.send({ exists: false })
    const key = rows[0].api_key
    return reply.send({
      exists: true,
      preview: `${key.slice(0, 12)}...${key.slice(-4)}`,
      createdAt: rows[0].created_at,
    })
  })

  /**
   * POST /api/auth/api-key — generate (or regenerate) API key (admin only)
   * Returns the full key once — store it immediately.
   */
  app.post('/api/auth/api-key', { preHandler: [requireAdmin] }, async (_req, reply) => {
    const key = `agnus_${crypto.randomBytes(32).toString('hex')}`
    await pool.query(
      `INSERT INTO system_api_keys (id, api_key) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET api_key = EXCLUDED.api_key, created_at = NOW()`,
      [key],
    )
    return reply.send({ key })
  })

  /**
   * POST /api/auth/register — use invite token to create account
   */
  app.post('/api/auth/register', { config: { rateLimit: authRateLimit } }, async (req, reply) => {
    const { token, email, password } = req.body as {
      token?: string; email?: string; password?: string
    }
    if (!token || !email || !password) {
      return reply.status(400).send({ error: 'token, email, and password are required' })
    }
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) {
      return reply.status(400).send({ error: 'token, email, and password are required' })
    }

    const { rows } = await pool.query<{
      token: string; used_at: string | null; org_id: string | null; org_role: OrgRole | string | null
    }>('SELECT token, used_at, org_id, org_role FROM invites WHERE token = $1', [token])

    const invite = rows[0]
    if (!invite) return reply.status(400).send({ error: 'Invalid invite token' })
    if (invite.used_at) return reply.status(400).send({ error: 'Invite already used' })

    const existingUser = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail])
    if (existingUser.rows.length > 0) return reply.status(409).send({ error: 'Email already exists' })

    // Mark invite as used
    await pool.query('UPDATE invites SET used_at = NOW() WHERE token = $1', [token])

    const id = crypto.randomUUID()
    const hash = await bcrypt.hash(password, 10)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'member')`,
      [id, normalizedEmail, hash],
    )
    if (invite.org_id) {
      await pool.query(
        `INSERT INTO org_members (org_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [invite.org_id, id, coerceOrgRole(invite.org_role, 'member')],
      )
    }

    let activeOrgId = invite.org_id
    let activeOrgRole = coerceOrgRole(invite.org_role, 'member')
    if (!activeOrgId) {
      const firstOrg = await pool.query<{ org_id: string; role: OrgRole | string }>(
        `SELECT org_id, role FROM org_members WHERE user_id = $1 ORDER BY joined_at ASC LIMIT 1`,
        [id],
      )
      activeOrgId = firstOrg.rows[0]?.org_id ?? null
      activeOrgRole = firstOrg.rows[0] ? coerceOrgRole(firstOrg.rows[0].role, 'member') : 'member'
    }

    const jwt = app.jwt.sign({
      id,
      email: normalizedEmail,
      role: 'member',
      isSystemAdmin: false,
      activeOrgId,
      activeOrgRole,
    })
    reply.setCookie('agnus_session', jwt, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    return reply.send({ ok: true })
  })
}
