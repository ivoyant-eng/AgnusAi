import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { requireAuth, requireAdmin } from '../auth/middleware'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db

  /**
   * POST /api/auth/login — verify email + password, set httpOnly cookie
   */
  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' })
    }

    const { rows } = await pool.query<{
      id: string; email: string; password_hash: string; role: string
    }>('SELECT id, email, password_hash, role FROM users WHERE email = $1', [email])

    const user = rows[0]
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const token = app.jwt.sign({ id: user.id, email: user.email, role: user.role })
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
    const user = req.user as { id: string; email: string; role: string }
    return reply.send({ id: user.id, email: user.email, role: user.role })
  })

  /**
   * POST /api/auth/invite — admin generates a one-time invite token
   */
  app.post('/api/auth/invite', { preHandler: [requireAdmin] }, async (req, reply) => {
    const admin = req.user as { id: string }
    const { email } = (req.body as { email?: string }) ?? {}

    const token = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO invites (token, email, created_by) VALUES ($1, $2, $3)`,
      [token, email ?? null, admin.id],
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
  app.post('/api/auth/register', async (req, reply) => {
    const { token, email, password } = req.body as {
      token?: string; email?: string; password?: string
    }
    if (!token || !email || !password) {
      return reply.status(400).send({ error: 'token, email, and password are required' })
    }

    const { rows } = await pool.query<{
      token: string; used_at: string | null
    }>('SELECT token, used_at FROM invites WHERE token = $1', [token])

    const invite = rows[0]
    if (!invite) return reply.status(400).send({ error: 'Invalid invite token' })
    if (invite.used_at) return reply.status(400).send({ error: 'Invite already used' })

    // Mark invite as used
    await pool.query('UPDATE invites SET used_at = NOW() WHERE token = $1', [token])

    const id = crypto.randomUUID()
    const hash = await bcrypt.hash(password, 10)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'member')`,
      [id, email, hash],
    )

    const jwt = app.jwt.sign({ id, email, role: 'member' })
    reply.setCookie('agnus_session', jwt, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    return reply.send({ ok: true })
  })
}

