/**
 * Live integration tests — requires the stack to be running.
 *
 * Run:
 *   GITHUB_TOKEN=ghp_xxx pnpm --filter @agnus-ai/api test -- --testPathPattern=integration
 *
 * Required env:
 *   GITHUB_TOKEN   — GitHub PAT with repo read access (for dryRun review test)
 *
 * Optional env:
 *   API_URL        — default http://localhost:3000
 *   ADMIN_EMAIL    — default admin@agnusai.dev
 *   ADMIN_PASSWORD — default changeme
 */
export {}

const BASE = process.env.API_URL ?? 'http://localhost:3000'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'changeme'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? ''

const TARGET_REPO_URL = 'https://github.com/theashishmaurya/Acecodinglab'
const TARGET_PR = 51

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function get(path: string, cookie = '') {
  return fetch(`${BASE}${path}`, {
    headers: { cookie },
  })
}

async function post(path: string, body: unknown, cookie = '') {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

async function login(): Promise<string> {
  const res = await post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  expect(res.status).toBe(200)
  // Extract Set-Cookie header value
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/(agnus_session=[^;]+)/)
  expect(match).not.toBeNull()
  return match![1]
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Health', () => {
  it('GET /api/health → 200 ok', async () => {
    const res = await get('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
  })
})

describe('Auth', () => {
  it('POST /api/auth/login with valid credentials → 200 + session cookie', async () => {
    const cookie = await login()
    expect(cookie).toMatch(/^agnus_session=/)
  })

  it('POST /api/auth/login with wrong password → 401', async () => {
    const res = await post('/api/auth/login', { email: ADMIN_EMAIL, password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('GET /api/repos without auth → 401', async () => {
    const res = await get('/api/repos')
    expect(res.status).toBe(401)
  })
})

describe('Repos', () => {
  let cookie: string
  let repoId: string

  beforeAll(async () => {
    cookie = await login()
  })

  it('GET /api/repos → 200 array', async () => {
    const res = await get('/api/repos', cookie)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('POST /api/repos → registers target repo and returns repoId', async () => {
    const res = await post('/api/repos', {
      repoUrl: TARGET_REPO_URL,
      platform: 'github',
      token: GITHUB_TOKEN || undefined,
    }, cookie)

    // 202 = registered fresh, 200 = already exists — both acceptable
    expect([200, 202]).toContain(res.status)
    const body = await res.json() as any
    expect(body.repoId).toBeDefined()
    repoId = body.repoId
  })

  it('GET /api/repos/:id/precision → 200 with buckets array', async () => {
    if (!repoId) return
    const res = await get(`/api/repos/${repoId}/precision`, cookie)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toHaveProperty('buckets')
    expect(Array.isArray(body.buckets)).toBe(true)
    // Each bucket has the right shape
    for (const b of body.buckets) {
      expect(b).toHaveProperty('bucket')
      expect(b).toHaveProperty('total')
      expect(b).toHaveProperty('accepted')
      expect(['number', 'object']).toContain(typeof b.acceptanceRate) // number or null
    }
  })
})

describe('Dry-run review — PR #51 (requires GITHUB_TOKEN + LLM)', () => {
  let cookie: string
  let repoId: string

  beforeAll(async () => {
    cookie = await login()

    // Register repo (idempotent)
    const res = await post('/api/repos', {
      repoUrl: TARGET_REPO_URL,
      platform: 'github',
      token: GITHUB_TOKEN,
    }, cookie)
    const body = await res.json() as any
    repoId = body.repoId
  })

  const skip = !GITHUB_TOKEN

  it('POST /api/repos/:id/review?dryRun=true → returns comments with confidence', async () => {
    if (skip) {
      console.log('  ⚠ Skipped — set GITHUB_TOKEN to run dry-run review test')
      return
    }

    const res = await post(`/api/repos/${repoId}/review`, {
      prNumber: TARGET_PR,
      dryRun: true,
    }, cookie)

    expect(res.status).toBe(200)
    const body = await res.json() as any

    console.log(`  verdict: ${body.verdict}`)
    console.log(`  commentCount: ${body.commentCount}`)

    expect(body).toHaveProperty('verdict')
    expect(body).toHaveProperty('commentCount')
    expect(['approve', 'request_changes', 'comment']).toContain(body.verdict)

    if (body.comments && body.comments.length > 0) {
      console.log(`  sample comment[0]:`, {
        path: body.comments[0].path,
        line: body.comments[0].line,
        severity: body.comments[0].severity,
        confidence: body.comments[0].confidence,
      })

      // Every comment should have path + line
      for (const c of body.comments) {
        expect(c).toHaveProperty('path')
        expect(c).toHaveProperty('line')
        expect(c).toHaveProperty('body')
        expect(c).toHaveProperty('severity')
        // confidence is set by our new persist logic (may be null if LLM didn't emit it)
        expect('confidence' in c).toBe(true)
      }

      // All confidence values must be in valid range
      const withConfidence = body.comments.filter((c: any) => c.confidence !== null && c.confidence !== undefined)
      console.log(`  ${withConfidence.length}/${body.comments.length} comments have confidence score`)
      for (const c of withConfidence) {
        expect(c.confidence).toBeGreaterThanOrEqual(0.0)
        expect(c.confidence).toBeLessThanOrEqual(1.0)
      }
    }
  }, 180000) // LLM call can be slow on large models
})

describe('Feedback endpoint', () => {
  it('GET /api/feedback with invalid token → 400 or 403', async () => {
    const res = await get('/api/feedback?id=fake-id&signal=accepted&token=badtoken')
    expect([400, 403, 404]).toContain(res.status)
  })
})
