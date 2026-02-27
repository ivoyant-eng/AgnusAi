/**
 * Unit tests for the Azure incremental review iteration guard in review-runner.ts.
 * All external dependencies are mocked — no real DB or Azure connection needed.
 *
 * Run: pnpm --filter @agnus-ai/api test
 */
import type { Pool } from 'pg'

// jest.mock is hoisted above imports by Jest — must appear before any import that
// transitively touches these modules.
jest.mock('@agnus-ai/reviewer', () => ({
  AzureDevOpsAdapter: jest.fn(),
  GitHubAdapter: jest.fn(),
  PRReviewAgent: jest.fn().mockImplementation(() => ({
    setVCS: jest.fn(),
    setLLM: jest.fn(),
    review: jest.fn().mockResolvedValue({ verdict: 'comment', comments: [], summary: 'ok' }),
    incrementalReview: jest.fn().mockResolvedValue({ verdict: 'comment', comments: [], summary: 'ok' }),
    postReview: jest.fn().mockResolvedValue(undefined),
  })),
  createBackendFromEnv: jest.fn().mockReturnValue({}),
}))

jest.mock('../src/graph-cache', () => ({ getRepo: jest.fn().mockReturnValue(null) }))
jest.mock('../src/embedding-factory', () => ({ createEmbeddingAdapter: jest.fn().mockReturnValue(null) }))

import { AzureDevOpsAdapter } from '@agnus-ai/reviewer'
import { runReview } from '../src/review-runner'
import type { ReviewRunOptions } from '../src/review-runner'

const MockAdapter = AzureDevOpsAdapter as jest.MockedClass<typeof AzureDevOpsAdapter>

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a mock pg Pool whose query() answers the two SQL patterns used by the
 * iteration guard:
 *   SELECT last_reviewed_iteration  → lastReviewedIteration
 *   everything else (INSERT, UPDATE) → empty rows
 */
function makePool(lastReviewedIteration: number): jest.Mocked<Pool> {
  return {
    query: jest.fn().mockImplementation(async (sql: string) => {
      if ((sql as string).includes('SELECT last_reviewed_iteration')) {
        return { rows: [{ last_reviewed_iteration: lastReviewedIteration }] }
      }
      return { rows: [] }
    }),
  } as unknown as jest.Mocked<Pool>
}

type MockAdapterInstance = {
  getLatestIterationId: jest.Mock
  getDiff: jest.Mock
  compareToIteration: number | undefined
}

let mockAdapter: MockAdapterInstance

const BASE_OPTS: Omit<ReviewRunOptions, 'pool'> = {
  platform: 'azure',
  repoId: 'test-repo',
  repoUrl: 'https://dev.azure.com/org/proj/_git/myrepo',
  prNumber: 42,
  token: 'fake-pat',
  baseBranch: 'main',
  incrementalDiff: true,
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Azure iteration guard — runReview()', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAdapter = {
      getLatestIterationId: jest.fn(),
      // Empty diff causes executeReview to bail before touching reviews/repos tables
      getDiff: jest.fn().mockResolvedValue({ files: [] }),
      compareToIteration: undefined,
    }
    MockAdapter.mockImplementation(() => mockAdapter as any)
  })

  // ── skip cases ─────────────────────────────────────────────────────────────

  describe('skip cases (no review triggered)', () => {
    it('skips when latestIteration equals lastReviewed (reviewer added, vote cast, etc.)', async () => {
      mockAdapter.getLatestIterationId.mockResolvedValue(5)
      const pool = makePool(5)

      const result = await runReview({ ...BASE_OPTS, pool })

      expect(result).toEqual({ verdict: 'comment', commentCount: 0, reviewId: '' })
      const sqls = pool.query.mock.calls.map(c => c[0] as string)
      expect(sqls.some(q => q.includes('INSERT INTO pr_review_state'))).toBe(false)
    })

    it('skips when latestIteration < lastReviewed (late-arriving / replayed webhook)', async () => {
      mockAdapter.getLatestIterationId.mockResolvedValue(4)
      const pool = makePool(5)

      const result = await runReview({ ...BASE_OPTS, pool })

      expect(result).toEqual({ verdict: 'comment', commentCount: 0, reviewId: '' })
    })
  })

  // ── proceed cases ──────────────────────────────────────────────────────────

  describe('proceed cases (new commit pushed)', () => {
    it('proceeds when latestIteration > lastReviewed and persists the new iteration', async () => {
      mockAdapter.getLatestIterationId.mockResolvedValue(6)
      const pool = makePool(5)

      await runReview({ ...BASE_OPTS, pool })

      const saveCall = pool.query.mock.calls.find(c =>
        (c[0] as string).includes('INSERT INTO pr_review_state'),
      )
      expect(saveCall).toBeDefined()
      // params: [repoId, prNumber, latestIteration]
      expect(saveCall![1]).toEqual(['test-repo', 42, 6])
    })

    it('sets compareToIteration = lastReviewed so getDiff only covers new commits', async () => {
      mockAdapter.getLatestIterationId.mockResolvedValue(6)
      const pool = makePool(5)

      await runReview({ ...BASE_OPTS, pool })

      expect(mockAdapter.compareToIteration).toBe(5)
    })

    it('uses compareToIteration = 0 when no prior DB row (first review ever)', async () => {
      mockAdapter.getLatestIterationId.mockResolvedValue(1)
      const pool = makePool(0) // no row → defaults to 0

      await runReview({ ...BASE_OPTS, pool })

      expect(mockAdapter.compareToIteration).toBe(0)
    })
  })

  // ── created event ──────────────────────────────────────────────────────────

  describe('created event (incrementalDiff=false)', () => {
    it('runs a full review and saves the iteration so the first updated event is correctly gated', async () => {
      mockAdapter.getLatestIterationId.mockResolvedValue(1)
      const pool = makePool(0)

      await runReview({ ...BASE_OPTS, pool, incrementalDiff: false })

      expect(mockAdapter.getLatestIterationId).toHaveBeenCalledWith(42)
      const saveCall = pool.query.mock.calls.find(c =>
        (c[0] as string).includes('INSERT INTO pr_review_state'),
      )
      expect(saveCall).toBeDefined()
      expect(saveCall![1]).toEqual(['test-repo', 42, 1])
    })

    it('skips saving the iteration when dryRun=true', async () => {
      mockAdapter.getLatestIterationId.mockResolvedValue(1)
      const pool = makePool(0)

      await runReview({ ...BASE_OPTS, pool, incrementalDiff: false, dryRun: true })

      const saveCall = pool.query.mock.calls.find(c =>
        (c[0] as string).includes('INSERT INTO pr_review_state'),
      )
      expect(saveCall).toBeUndefined()
    })
  })
})
