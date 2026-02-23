import type { FastifyRequest, FastifyReply } from 'fastify'

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Allow service-to-service calls via Authorization: Bearer <api_key>
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    // Check env var (fast path)
    if (process.env.API_KEY && token === process.env.API_KEY) return
    // Check DB-stored key
    try {
      const { rows } = await (req.server as any).db.query(
        'SELECT api_key FROM system_api_keys WHERE id = 1',
      )
      if (rows[0]?.api_key === token) return
    } catch { /* DB not ready — fall through to JWT */ }
  }
  try {
    await req.jwtVerify()
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
  if ((req.user as any)?.role !== 'admin') {
    reply.status(403).send({ error: 'Forbidden' })
    return
  }
}
