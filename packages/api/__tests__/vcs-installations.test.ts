/**
 * VCS Installation API tests — calls the live stack.
 *
 * Run:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=changeme \
 *   API_URL=http://localhost:3000 \
 *   pnpm --filter @agnus-ai/api test -- --testPathPatterns=vcs-installations
 *
 * Required: stack running via `docker compose up`
 *
 * Cleanup: any resources created are tagged with displayName "__test__<runId>"
 * and deleted in afterAll. Run `scripts/test-cleanup.sh` to nuke leftover test
 * data if a test run was interrupted.
 */
export {}

const BASE = process.env.API_URL ?? 'http://localhost:3000'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'changeme'

// Tag all test-created resources so they're identifiable for cleanup
const TEST_TAG = `__test__${Date.now()}`

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function get(path: string, cookie = '') {
  return fetch(`${BASE}${path}`, { headers: { cookie } })
}

async function post(path: string, body: unknown, cookie = '') {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

async function del(path: string, cookie = '') {
  return fetch(`${BASE}${path}`, { method: 'DELETE', headers: { cookie } })
}

async function login(): Promise<string> {
  const res = await post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  expect(res.status).toBe(200)
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/(agnus_session=[^;]+)/)
  expect(match).not.toBeNull()
  return match![1]
}

// Track resources created during this run so afterAll can clean them up
const createdInstallationIds: string[] = []
const createdRepoIds: string[] = []

// ─── Global cleanup ───────────────────────────────────────────────────────────

afterAll(async () => {
  if (createdInstallationIds.length === 0 && createdRepoIds.length === 0) return
  const cookie = await login()
  for (const id of createdInstallationIds) {
    await del(`/api/vcs-installations/${id}`, cookie).catch(() => {})
  }
  for (const id of createdRepoIds) {
    await del(`/api/repos/${id}`, cookie).catch(() => {})
  }
})

// ─── Auth guards ──────────────────────────────────────────────────────────────

describe('VCS Installations — auth guards', () => {
  it('GET /api/vcs-installations without cookie → 401', async () => {
    const res = await get('/api/vcs-installations')
    expect(res.status).toBe(401)
  })

  it('POST /api/vcs-installations without cookie → 401', async () => {
    const res = await post('/api/vcs-installations', { platform: 'github', appId: '1', privateKey: 'k', installationId: '2' })
    expect(res.status).toBe(401)
  })

  it('DELETE /api/vcs-installations/unknown-id without cookie → 401', async () => {
    const res = await del('/api/vcs-installations/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(401)
  })

  it('POST /api/vcs-installations/unknown-id/repos without cookie → 401', async () => {
    const res = await post('/api/vcs-installations/00000000-0000-0000-0000-000000000000/repos', {})
    expect(res.status).toBe(401)
  })
})

// ─── GET /api/vcs-installations ──────────────────────────────────────────────

describe('GET /api/vcs-installations', () => {
  let cookie: string
  beforeAll(async () => { cookie = await login() })

  it('returns 200 with installations array', async () => {
    const res = await get('/api/vcs-installations', cookie)
    expect(res.status).toBe(200)
    const body = await res.json() as { installations: unknown[] }
    expect(Array.isArray(body.installations)).toBe(true)
  })

  it('never exposes private_key or client_secret fields', async () => {
    const res = await get('/api/vcs-installations', cookie)
    const body = await res.json() as { installations: Record<string, unknown>[] }
    for (const inst of body.installations) {
      expect('github_app_private_key' in inst).toBe(false)
      expect('privateKey' in inst).toBe(false)
      expect('azure_client_secret' in inst).toBe(false)
      expect('pat' in inst).toBe(false)
    }
  })
})

// ─── POST /api/vcs-installations — validation ────────────────────────────────

describe('POST /api/vcs-installations — validation', () => {
  let cookie: string
  beforeAll(async () => { cookie = await login() })

  it('returns 400 when platform is missing', async () => {
    const res = await post('/api/vcs-installations', { appId: '1', privateKey: 'k', installationId: '2' }, cookie)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/platform/i)
  })

  it('returns 400 for github platform without appId', async () => {
    const res = await post('/api/vcs-installations', { platform: 'github', installationId: '123' }, cookie)
    expect(res.status).toBe(400)
  })

  it('returns 400 for github platform without installationId', async () => {
    const res = await post('/api/vcs-installations', { platform: 'github', appId: '123' }, cookie)
    expect(res.status).toBe(400)
  })

  it('returns 400 when GitHub credentials are invalid (bad key)', async () => {
    const res = await post('/api/vcs-installations', {
      platform: 'github',
      appId: '0',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nbad\n-----END RSA PRIVATE KEY-----',
      installationId: '0',
      displayName: TEST_TAG,
    }, cookie)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBeTruthy()
  })
})

// ─── POST /api/vcs-installations/:id/repos — errors ─────────────────────────

describe('POST /api/vcs-installations/:id/repos — error cases', () => {
  let cookie: string
  beforeAll(async () => { cookie = await login() })

  it('returns 404 for unknown installation id', async () => {
    const res = await post('/api/vcs-installations/00000000-0000-0000-0000-000000000000/repos', {}, cookie)
    expect(res.status).toBe(404)
  })
})

// ─── DELETE /api/vcs-installations/:id ───────────────────────────────────────

describe('DELETE /api/vcs-installations/:id', () => {
  let cookie: string
  beforeAll(async () => { cookie = await login() })

  it('returns 404 for already-deleted or unknown id', async () => {
    const res = await del('/api/vcs-installations/00000000-0000-0000-0000-000000000000', cookie)
    expect(res.status).toBe(404)
  })
})

// ─── POST /api/repos with vcsInstallationId ───────────────────────────────────

describe('POST /api/repos with vcsInstallationId', () => {
  let cookie: string
  beforeAll(async () => { cookie = await login() })

  it('returns 404 when vcsInstallationId does not exist', async () => {
    const res = await post('/api/repos', {
      repoUrl: 'https://github.com/theashishmaurya/AgnusAi',
      platform: 'github',
      vcsInstallationId: '00000000-0000-0000-0000-000000000099',
    }, cookie)
    expect(res.status).toBe(404)
  })
})

// ─── GET /api/repos — fields ──────────────────────────────────────────────────

describe('GET /api/repos — returned fields include vcsInstallationId', () => {
  let cookie: string
  beforeAll(async () => { cookie = await login() })

  it('each repo row has vcsInstallationId field (may be null)', async () => {
    const res = await get('/api/repos', cookie)
    expect(res.status).toBe(200)
    const repos = await res.json() as Record<string, unknown>[]
    expect(Array.isArray(repos)).toBe(true)
    for (const repo of repos) {
      expect('vcsInstallationId' in repo || 'vcs_installation_id' in repo).toBe(true)
    }
  })

  it('each repo row has githubAppId field (may be null)', async () => {
    const res = await get('/api/repos', cookie)
    const repos = await res.json() as Record<string, unknown>[]
    for (const repo of repos) {
      expect('githubAppId' in repo || 'github_app_id' in repo).toBe(true)
    }
  })
})
