/**
 * E2E tests — multi-branch indexing.
 *
 * Uses real Postgres (must be running at DATABASE_URL) + Fastify inject().
 * Heavy deps (Indexer, LLM, VCS) are mocked so no Ollama or GitHub token needed.
 *
 * Verification matrix:
 *   Step 2  — POST /api/repos registers develop + release in repo_branches
 *   Step 3  — repo_branches has exactly 2 rows
 *   Step 4  — GitHub push to develop → only develop graph updated
 *   Step 4b — GitHub push to main (un-indexed) → no-op
 *   Step 5  — GitHub PR targeting develop → runReview({ baseBranch: 'develop' })
 *   Step 6  — GitHub PR targeting release → runReview({ baseBranch: 'release' })
 *   Step 7  — GitHub PR targeting main (un-indexed) → review still runs, no graph ctx
 *   Azure A — Azure push to develop → incrementalUpdate called with branch=develop
 *   Azure B — Azure PR targeting develop → runReview({ baseBranch: 'develop' })
 */
export {}

// ─── Environment (set before any imports) ────────────────────────────────────
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://agnus:agnus@localhost:5432/agnus'
process.env.WEBHOOK_SECRET = '' // empty = skip HMAC verification
process.env.EMBEDDING_PROVIDER = '' // disable embeddings
const RUN_MULTI_BRANCH_TESTS = process.env.RUN_MULTI_BRANCH_TESTS === 'true'
const describeMB = RUN_MULTI_BRANCH_TESTS ? describe : describe.skip

// ─── Module mocks (hoisted by ts-jest above imports) ─────────────────────────

jest.mock('../src/embedding-factory', () => ({
  createEmbeddingAdapter: jest.fn().mockReturnValue(null),
}))

jest.mock('@agnus-ai/core', () => ({
  createDefaultRegistry: jest.fn().mockResolvedValue({ parseFile: jest.fn().mockReturnValue(null) }),
  InMemorySymbolGraph: jest.fn().mockImplementation(() => ({
    addSymbol: jest.fn(),
    addEdge: jest.fn(),
    removeFile: jest.fn(),
    getAllSymbols: jest.fn().mockReturnValue([]),
    getAllEdges: jest.fn().mockReturnValue([]),
    serialize: jest.fn().mockReturnValue('{}'),
    getBlastRadius: jest.fn().mockReturnValue({ affected: [], riskScore: 0, affectedFiles: [] }),
  })),
  PostgresStorageAdapter: jest.fn().mockImplementation(() => ({
    migrate: jest.fn().mockResolvedValue(undefined),
    saveSymbols: jest.fn().mockResolvedValue(undefined),
    saveEdges: jest.fn().mockResolvedValue(undefined),
    deleteByFile: jest.fn().mockResolvedValue(undefined),
    loadAll: jest.fn().mockResolvedValue({ symbols: [], edges: [] }),
    saveGraphSnapshot: jest.fn().mockResolvedValue(undefined),
    loadGraphSnapshot: jest.fn().mockResolvedValue(null),
  })),
  Indexer: jest.fn().mockImplementation(() => ({
    fullIndex: jest.fn().mockResolvedValue({ symbolCount: 0, edgeCount: 0, fileCount: 0, durationMs: 0 }),
    incrementalUpdate: jest.fn().mockResolvedValue(undefined),
    loadFromStorage: jest.fn().mockResolvedValue(undefined),
  })),
  Retriever: jest.fn().mockImplementation(() => ({
    getReviewContext: jest.fn().mockResolvedValue(undefined),
  })),
}))

jest.mock('../src/review-runner', () => ({
  runReview: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../src/graph-cache', () => ({
  initGraphCache: jest.fn(),
  warmupAllRepos: jest.fn().mockResolvedValue(undefined),
  loadRepo: jest.fn().mockResolvedValue(undefined),
  getRepo: jest.fn().mockReturnValue(null),
  getOrLoadRepo: jest.fn().mockResolvedValue({
    indexer: { incrementalUpdate: jest.fn().mockResolvedValue(undefined) },
    graph: {},
    retriever: {},
    storage: {},
  }),
  evictRepo: jest.fn(),
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/index'

// Typed access to mocked modules
const { runReview } = jest.requireMock('../src/review-runner') as { runReview: jest.MockedFunction<any> }
const graphCache = jest.requireMock('../src/graph-cache') as {
  getOrLoadRepo: jest.MockedFunction<any>
  getRepo: jest.MockedFunction<any>
  evictRepo: jest.MockedFunction<any>
}

// ─── Test constants ────────────────────────────────────────────────────────────
const TEST_REPO_URL = 'https://github.com/test-org/e2e-branch-test'
const TEST_REPO_ID = Buffer.from(TEST_REPO_URL).toString('base64url').slice(0, 32)

// Flush pending setImmediate callbacks — works for mocked async chains
async function flushImmediate(): Promise<void> {
  await new Promise<void>(r => setImmediate(r))
  await new Promise<void>(r => setImmediate(r))
}

// Poll until a mock has been called at least once (handles real async DB queries inside setImmediate)
async function waitForCall(mockFn: jest.MockedFunction<any>, timeout = 3000): Promise<void> {
  const start = Date.now()
  while (mockFn.mock.calls.length === 0) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timeout: mock was never called after ${timeout}ms`)
    }
    await new Promise<void>(r => setTimeout(r, 20))
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
let app: FastifyInstance
let pool: Pool

beforeAll(async () => {
  if (!RUN_MULTI_BRANCH_TESTS) return
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
  app = await buildServer()

  // Ensure tables exist (normally done in main(); buildServer() skips this)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repos (
      repo_id TEXT PRIMARY KEY,
      repo_url TEXT NOT NULL,
      platform TEXT NOT NULL,
      token TEXT,
      repo_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repo_branches (
      repo_id TEXT NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
      branch TEXT NOT NULL,
      PRIMARY KEY (repo_id, branch)
    )
  `)

  // Seed: register test repo with two branches (Step 2 prerequisite for Steps 4-7)
  await pool.query('DELETE FROM repos WHERE repo_id = $1', [TEST_REPO_ID])
  const seed = await app.inject({
    method: 'POST',
    url: '/api/repos',
    headers: { 'content-type': 'application/json' },
    payload: { repoUrl: TEST_REPO_URL, platform: 'github', branches: ['develop', 'release'] },
  })
  expect(seed.statusCode).toBe(202)
}, 30000)

afterAll(async () => {
  if (!RUN_MULTI_BRANCH_TESTS) return
  await pool.query('DELETE FROM repos WHERE repo_id = $1', [TEST_REPO_ID])
  await pool.end()
  await app.close()
})

afterEach(() => {
  if (!RUN_MULTI_BRANCH_TESTS) return
  jest.clearAllMocks()
  runReview.mockResolvedValue(undefined)
  graphCache.getOrLoadRepo.mockResolvedValue({
    indexer: { incrementalUpdate: jest.fn().mockResolvedValue(undefined) },
    graph: {},
    retriever: {},
    storage: {},
  })
})

// ─── Step 2: Register repo with two branches ─────────────────────────────────
describeMB('Step 2 — POST /api/repos with branches=[develop, release]', () => {
  it('returns 202 with repoId and branches list', async () => {
    // Additional registration to test the response body directly
    await pool.query('DELETE FROM repos WHERE repo_id = $1', [TEST_REPO_ID])

    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: { 'content-type': 'application/json' },
      payload: { repoUrl: TEST_REPO_URL, platform: 'github', branches: ['develop', 'release'] },
    })

    expect(res.statusCode).toBe(202)
    const body = JSON.parse(res.body)
    expect(body.repoId).toBe(TEST_REPO_ID)
    expect(body.branches).toEqual(['develop', 'release'])
    expect(body.message).toMatch(/2 branch/)
  })
})

// ─── Step 3: repo_branches has two rows ──────────────────────────────────────
describeMB('Step 3 — repo_branches has exactly 2 rows', () => {
  it('DB has develop and release entries for the test repo', async () => {
    const res = await pool.query(
      'SELECT branch FROM repo_branches WHERE repo_id = $1 ORDER BY branch',
      [TEST_REPO_ID],
    )
    expect(res.rows.map((r: any) => r.branch)).toEqual(['develop', 'release'])
  })
})

// ─── Step 4: Push to develop — only develop graph updated ────────────────────
describeMB('Step 4 — GitHub push to develop', () => {
  it('calls getOrLoadRepo(repoId, "develop") and incrementalUpdate with branch=develop', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined)
    graphCache.getOrLoadRepo.mockResolvedValue({
      indexer: { incrementalUpdate: mockUpdate },
      graph: {},
      retriever: {},
      storage: {},
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=ignored',
      },
      payload: {
        ref: 'refs/heads/develop',
        repository: { html_url: TEST_REPO_URL },
        commits: [{ added: ['src/auth.ts'], modified: ['src/token.ts'], removed: [] }],
      },
    })

    expect(res.statusCode).toBe(200)
    await flushImmediate()

    // Correct branch passed to cache lookup
    expect(graphCache.getOrLoadRepo).toHaveBeenCalledWith(TEST_REPO_ID, 'develop')
    // incrementalUpdate receives files AND the correct branch
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.arrayContaining(['src/auth.ts', 'src/token.ts']),
      TEST_REPO_ID,
      'develop',
    )
    // release graph NOT touched
    expect(graphCache.getOrLoadRepo).not.toHaveBeenCalledWith(TEST_REPO_ID, 'release')
  })
})

// ─── Step 4b: Push to main (un-indexed) — no-op ──────────────────────────────
describeMB('Step 4b — GitHub push to main (un-indexed branch)', () => {
  it('returns 200 but does NOT call getOrLoadRepo (branch guard fires)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=ignored',
      },
      payload: {
        ref: 'refs/heads/main',
        repository: { html_url: TEST_REPO_URL },
        commits: [{ added: ['src/utils.ts'], modified: [], removed: [] }],
      },
    })

    expect(res.statusCode).toBe(200)
    await flushImmediate()

    // Branch guard: main is not in repo_branches → getOrLoadRepo never called
    expect(graphCache.getOrLoadRepo).not.toHaveBeenCalled()
  })
})

// ─── Step 5: PR targeting develop → baseBranch='develop' ─────────────────────
describeMB('Step 5 — GitHub PR opened targeting develop', () => {
  it('calls runReview with baseBranch=develop', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=ignored',
      },
      payload: {
        action: 'opened',
        pull_request: { number: 42, base: { ref: 'develop' } },
        repository: { html_url: TEST_REPO_URL },
      },
    })

    expect(res.statusCode).toBe(200)
    await waitForCall(runReview)

    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'github',
      repoId: TEST_REPO_ID,
      prNumber: 42,
      baseBranch: 'develop',
    }))
  })
})

// ─── Step 6: PR targeting release → baseBranch='release' ─────────────────────
describeMB('Step 6 — GitHub PR synchronize targeting release', () => {
  it('calls runReview with baseBranch=release', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=ignored',
      },
      payload: {
        action: 'synchronize',
        pull_request: { number: 99, base: { ref: 'release' } },
        repository: { html_url: TEST_REPO_URL },
      },
    })

    expect(res.statusCode).toBe(200)
    await waitForCall(runReview)

    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'github',
      repoId: TEST_REPO_ID,
      prNumber: 99,
      baseBranch: 'release',
    }))
  })
})

// ─── Step 7: PR targeting main (un-indexed) — graceful degradation ────────────
describeMB('Step 7 — GitHub PR targeting main (un-indexed)', () => {
  it('still calls runReview (review runs) with baseBranch=main', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=ignored',
      },
      payload: {
        action: 'opened',
        pull_request: { number: 7, base: { ref: 'main' } },
        repository: { html_url: TEST_REPO_URL },
      },
    })

    expect(res.statusCode).toBe(200)
    await waitForCall(runReview)

    // Review still fires — graceful degradation (no graph context, but review runs)
    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({
      baseBranch: 'main',
      prNumber: 7,
    }))
  })
})

// ─── Azure: push to develop ───────────────────────────────────────────────────
describeMB('Azure A — git.push to develop', () => {
  it('extracts branch from refUpdates and calls incrementalUpdate(branch=develop)', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined)
    graphCache.getOrLoadRepo.mockResolvedValue({
      indexer: { incrementalUpdate: mockUpdate },
      graph: {},
      retriever: {},
      storage: {},
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/azure',
      headers: { 'content-type': 'application/json' },
      payload: {
        eventType: 'git.push',
        resource: {
          refUpdates: [{ name: 'refs/heads/develop' }],
          repository: { remoteUrl: TEST_REPO_URL },
          commits: [{ changes: [{ item: { path: '/src/parser.ts' } }] }],
        },
      },
    })

    expect(res.statusCode).toBe(200)
    await flushImmediate()

    expect(graphCache.getOrLoadRepo).toHaveBeenCalledWith(TEST_REPO_ID, 'develop')
    expect(mockUpdate).toHaveBeenCalledWith(['src/parser.ts'], TEST_REPO_ID, 'develop')
  })
})

// ─── Azure: PR targeting develop ─────────────────────────────────────────────
describeMB('Azure B — git.pullrequest.created targeting develop', () => {
  it('extracts baseBranch from targetRefName and calls runReview(baseBranch=develop)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/azure',
      headers: { 'content-type': 'application/json' },
      payload: {
        eventType: 'git.pullrequest.created',
        resource: {
          pullRequestId: 55,
          targetRefName: 'refs/heads/develop',
          repository: { remoteUrl: TEST_REPO_URL },
        },
      },
    })

    expect(res.statusCode).toBe(200)
    await waitForCall(runReview)

    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'azure',
      prNumber: 55,
      baseBranch: 'develop',
    }))
  })
})

// ─── DELETE /api/repos/:id evicts all branches ────────────────────────────────
describeMB('DELETE /api/repos/:id', () => {
  it('deletes from DB and calls evictRepo(repoId) with no branch arg', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/repos/${TEST_REPO_ID}`,
    })

    expect(res.statusCode).toBe(204)
    expect(graphCache.evictRepo).toHaveBeenCalledWith(TEST_REPO_ID)

    const dbCheck = await pool.query('SELECT 1 FROM repos WHERE repo_id = $1', [TEST_REPO_ID])
    expect(dbCheck.rows).toHaveLength(0)
  })
})
