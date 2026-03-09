/**
 * Live smoke/integration tests for signup uniqueness and webhook security.
 * Requires running API stack.
 */
import { Pool } from 'pg'
export {}

const BASE = process.env.API_URL ?? 'http://localhost'
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'local-dev-secret'
const CLEANUP_DB_URL = process.env.TEST_CLEANUP_DATABASE_URL ?? process.env.DATABASE_URL ?? ''

function randomTestIp(prefix = 240): string {
  return `10.${prefix}.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`
}

const createdOrgIds: string[] = []
const createdEmails: string[] = []

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const ip = randomTestIp()
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify(body),
  })
}

async function isRateLimitedResponse(res: Response): Promise<boolean> {
  if (res.status !== 429 && res.status !== 500) return false
  const body = await res.clone().json().catch(() => ({})) as { error?: string; message?: string }
  const text = `${body.error ?? ''} ${body.message ?? ''}`.toLowerCase()
  return text.includes('too many requests') || text.includes('rate limit')
}

describe('smoke: azure webhook secret', () => {
  const unknownRepo = 'https://dev.azure.com/ghost-org/ghost-proj/_git/ghost-repo'

  it('rejects azure webhook without X-Webhook-Secret', async () => {
    const res = await post('/api/webhooks/azure', {
      eventType: 'git.pullrequest.created',
      resource: {
        pullRequestId: 90101,
        repository: { remoteUrl: unknownRepo },
      },
    })
    expect(res.status).toBe(401)
  })

  it('accepts azure webhook with X-Webhook-Secret', async () => {
    const res = await post(
      '/api/webhooks/azure',
      {
        eventType: 'git.pullrequest.created',
        resource: {
          pullRequestId: 90102,
          repository: { remoteUrl: unknownRepo },
        },
      },
      { 'x-webhook-secret': WEBHOOK_SECRET },
    )
    expect(res.status).toBe(200)
  })
})

describe('integration: signup org behavior', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`

  afterAll(async () => {
    if (!CLEANUP_DB_URL) return
    const pool = new Pool({ connectionString: CLEANUP_DB_URL })
    try {
      if (createdOrgIds.length > 0) {
        await pool.query('DELETE FROM organizations WHERE id = ANY($1::text[])', [createdOrgIds])
      }
      if (createdEmails.length > 0) {
        await pool.query('DELETE FROM users WHERE LOWER(email) = ANY($1::text[])', [createdEmails.map(e => e.toLowerCase())])
      }
    } catch (err) {
      // Cleanup is best-effort for live environments.
      console.warn('cleanup failed:', (err as Error).message)
    } finally {
      await pool.end().catch(() => {})
    }
  })

  it('auto-generates unique slugs when slug is omitted', async () => {
    const orgName1 = `Platform Nx ${suffix} !!!`
    const orgName2 = `Platform-Nx ${suffix}`
    const email1 = `user1-${suffix}@example.com`
    const email2 = `user2-${suffix}@example.com`

    const first = await post('/api/auth/signup', {
      email: email1,
      password: '1234test',
      orgName: orgName1,
    })
    if (await isRateLimitedResponse(first)) {
      console.warn('skipping auto-slug assertion due live rate-limit saturation')
      return
    }
    expect(first.status).toBe(200)
    const firstBody = await first.json() as any
    expect(firstBody.org?.slug).toBeTruthy()
    if (firstBody.org?.id) createdOrgIds.push(firstBody.org.id)
    createdEmails.push(email1)

    const second = await post('/api/auth/signup', {
      email: email2,
      password: '1234test',
      orgName: orgName2,
    })
    if (await isRateLimitedResponse(second)) {
      console.warn('skipping auto-slug assertion due live rate-limit saturation')
      return
    }
    expect(second.status).toBe(200)
    const secondBody = await second.json() as any

    expect(secondBody.org?.slug).toBeTruthy()
    if (secondBody.org?.id) createdOrgIds.push(secondBody.org.id)
    createdEmails.push(email2)
    expect(secondBody.org.slug).not.toBe(firstBody.org.slug)
    expect(secondBody.org.slug.startsWith(`${firstBody.org.slug}-`)).toBe(true)
  })

  it('returns 409 when custom slug is already taken (case-insensitive)', async () => {
    const customSlug = `platform-team-${suffix}`
    const orgName = `Platform Nx Team ${suffix}`
    const email3 = `user3-${suffix}@example.com`
    const email4 = `user4-${suffix}@example.com`

    const first = await post('/api/auth/signup', {
      email: email3,
      password: '1234test',
      orgName,
      orgSlug: customSlug,
    })
    if (await isRateLimitedResponse(first)) {
      console.warn('skipping custom-slug conflict assertion due live rate-limit saturation')
      return
    }
    expect(first.status).toBe(200)
    const firstBody = await first.json() as any
    if (firstBody.org?.id) createdOrgIds.push(firstBody.org.id)
    createdEmails.push(email3)

    const second = await post('/api/auth/signup', {
      email: email4,
      password: '1234test',
      orgName: `${orgName} 2`,
      orgSlug: customSlug.toUpperCase(),
    })
    expect(second.status).toBe(409)
    const body = await second.json() as any
    expect(String(body.error || '')).toMatch(/slug/i)
    createdEmails.push(email4)
  })
})
