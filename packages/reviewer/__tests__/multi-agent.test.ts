import { runReviewWithSpecialists } from '../src/review/multi-agent'
import type { LLMBackend } from '../src/llm/base'
import type { ReviewContext, ReviewResult } from '../src/types'

function makeContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    pr: {
      id: '1',
      number: 1,
      title: 'Test PR',
      description: '',
      author: { id: 'u1', username: 'ashish' },
      sourceBranch: 'feature',
      targetBranch: 'main',
      url: 'https://example.test/pr/1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    diff: {
      files: [],
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    },
    files: [],
    tickets: [],
    skills: [],
    config: {
      maxDiffSize: 10000,
      focusAreas: [],
      ignorePaths: [],
      multiAgentEnabled: true,
      reviewMode: 'fast',
      judgeEnabled: true,
    },
    ...overrides,
  }
}

describe('runReviewWithSpecialists', () => {
  test('returns null when multi-agent is disabled', async () => {
    const context = makeContext({
      config: {
        maxDiffSize: 10000,
        focusAreas: [],
        ignorePaths: [],
        multiAgentEnabled: false,
        reviewMode: 'single',
      },
    })
    const llm = {
      generateReview: jest.fn(),
    } as unknown as LLMBackend
    const result = await runReviewWithSpecialists(llm, context)
    expect(result).toBeNull()
  })

  test('deduplicates same path/line/body from specialist outputs', async () => {
    const context = makeContext()
    const commonComment = {
      path: 'src/index.ts',
      line: 12,
      body: 'Potential bug in null handling',
      severity: 'warning' as const,
      confidence: 0.9,
    }
    const llm = {
      generateReview: jest
        .fn()
        .mockResolvedValueOnce({
          summary: 'security summary',
          comments: [commonComment],
          suggestions: [],
          verdict: 'request_changes',
        } satisfies ReviewResult)
        .mockResolvedValueOnce({
          summary: 'correctness summary',
          comments: [commonComment],
          suggestions: [],
          verdict: 'request_changes',
        } satisfies ReviewResult),
    } as unknown as LLMBackend

    const result = await runReviewWithSpecialists(llm, context)
    expect(result).not.toBeNull()
    expect(result?.comments).toHaveLength(1)
    expect(result?.agentTelemetry).toHaveLength(2)
    expect(result?.verdict).toBe('request_changes')
    expect(result?.comments[0]?.sourceAgent).toBeDefined()
  })
})
