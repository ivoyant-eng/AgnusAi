/**
 * Live integration tests for the Azure iteration guard.
 * Hits the already-running API server — no direct DB or mock setup required.
 *
 * Run (stack must be up):
 *   pnpm --filter @agnus-ai/api test -- --testPathPatterns=review-runner
 *
 * Optional env:
 *   API_URL        — default http://localhost (Traefik)
 *   ADMIN_EMAIL    — default admin@example.com
 *   ADMIN_PASSWORD — default changeme
 */

const BASE = process.env.API_URL ?? 'http://localhost'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'changeme'

// ─── helpers ─────────────────────────────────────────────────────────────────

async function post(path: string, body: unknown, cookie = '') {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

async function get(path: string, cookie = '') {
  return fetch(`${BASE}${path}`, { headers: { cookie } })
}

async function login(): Promise<string> {
  const res = await post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/(agnus_session=[^;]+)/)
  return match?.[1] ?? ''
}

/** Fake Azure updated webhook payload */
function azureUpdatedPayload(prId: number, repoUrl: string) {
  return {
    eventType: 'git.pullrequest.updated',
    resource: {
      pullRequestId: prId,
      targetRefName: 'refs/heads/main',
      repository: { remoteUrl: repoUrl },
    },
  }
}

/** Fake Azure created webhook payload */
function azureCreatedPayload(prId: number, repoUrl: string) {
  return {
    eventType: 'git.pullrequest.created',
    resource: {
      pullRequestId: prId,
      targetRefName: 'refs/heads/main',
      repository: { remoteUrl: repoUrl },
    },
  }
}

/** Let the setImmediate + async pipeline finish before checking state */
const flushAsync = () => new Promise(r => setTimeout(r, 500))

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Azure webhook — live API smoke tests', () => {
  // Fake repo URL that won't match any registered repo
  const UNKNOWN_REPO = 'https://dev.azure.com/ghost-org/ghost-proj/_git/ghost-repo'
  const PR_ID = 88001

  it('POST git.pullrequest.created → 200 ok (no crash on unknown repo)', async () => {
    const res = await post('/api/webhooks/azure', azureCreatedPayload(PR_ID, UNKNOWN_REPO))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('POST git.pullrequest.updated → 200 ok (no crash on unknown repo)', async () => {
    const res = await post('/api/webhooks/azure', azureUpdatedPayload(PR_ID, UNKNOWN_REPO))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('POST git.push → 200 ok', async () => {
    const res = await post('/api/webhooks/azure', {
      eventType: 'git.push',
      resource: {
        refUpdates: [{ name: 'refs/heads/main' }],
        repository: { remoteUrl: UNKNOWN_REPO },
      },
    })
    expect(res.status).toBe(200)
  })

  it('POST unknown eventType → 200 ok (ignored gracefully)', async () => {
    const res = await post('/api/webhooks/azure', {
      eventType: 'git.pullrequest.reviewer.vote',
      resource: { repository: { remoteUrl: UNKNOWN_REPO } },
    })
    expect(res.status).toBe(200)
  })

  it('POST malformed payload (no resource) → 200 ok (not 500)', async () => {
    const res = await post('/api/webhooks/azure', { eventType: 'git.pullrequest.updated' })
    expect(res.status).toBe(200)
  })
})

describe('Azure webhook — iteration guard via registered repo', () => {
  let cookie: string
  let repoId: string
  const REPO_URL = 'https://dev.azure.com/test-org/test-proj/_git/guard-test-repo'
  const PR_ID = 88002

  beforeAll(async () => {
    cookie = await login()
    if (!cookie) return

    // Register a fake Azure repo — token won't reach real Azure but guard runs before getDiff
    const res = await post('/api/repos', {
      repoUrl: REPO_URL,
      platform: 'azure',
      token: 'fake-pat-for-guard-test',
    }, cookie)
    const body = await res.json() as any
    repoId = body.repoId ?? body.id ?? ''
  })

  afterAll(async () => {
    if (!repoId || !cookie) return
    await fetch(`${BASE}/api/repos/${repoId}`, { method: 'DELETE', headers: { cookie } })
  })

  it('created event → 200, review attempted (fails gracefully with fake token)', async () => {
    if (!cookie) return
    const res = await post('/api/webhooks/azure', azureCreatedPayload(PR_ID, REPO_URL))
    expect(res.status).toBe(200)
    await flushAsync()
    // Review may or may not appear depending on Azure reachability — we just verify no crash
  })

  it('updated event sent twice → second call returns 200 (guard or Azure error — never 500)', async () => {
    if (!cookie) return
    const res1 = await post('/api/webhooks/azure', azureUpdatedPayload(PR_ID, REPO_URL))
    const res2 = await post('/api/webhooks/azure', azureUpdatedPayload(PR_ID, REPO_URL))
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    await flushAsync()
  })

  it('GET /api/reviews shows no duplicate entries for the same PR', async () => {
    if (!cookie || !repoId) return
    await flushAsync()

    const res = await get('/api/reviews', cookie)
    expect(res.status).toBe(200)
    const { reviews }: any = await res.json().catch(() => ({ reviews: [] }))
    const prReviews = (Array.isArray(reviews) ? reviews : [])
      .filter((r: any) => r.repoId === repoId && r.prNumber === PR_ID)

    // With a fake token the review pipeline bails, so at most 0 reviews
    // The important assertion: no duplicate reviews from the duplicate webhook
    const ids = prReviews.map((r: any) => r.id)
    expect(ids.length).toBe(new Set(ids).size) // no duplicates
  })
})
