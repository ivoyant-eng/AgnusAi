import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { Pool } from 'pg'

export async function seedAdminUser(pool: Pool): Promise<void> {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return

  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users')
  if (parseInt(rows[0].count, 10) > 0) return

  const id = crypto.randomUUID()
  const hash = await bcrypt.hash(password, 10)
  await pool.query(
    `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
    [id, email, hash],
  )
  console.info(`[seed] Admin user created: ${email}`)
}
