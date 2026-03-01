import {
  evaluateRuleSignals,
  extractRuleNameFromComment,
  isRuleApplicable,
  matchesPathPattern,
  type RuleCandidate,
} from '../src/rules-enforcement'

describe('rules-enforcement', () => {
  test('matchesPathPattern handles simple and recursive globs', () => {
    expect(matchesPathPattern('packages/api/src/index.ts', 'packages/api/**')).toBe(true)
    expect(matchesPathPattern('/packages/dashboard/src/App.tsx', 'packages/dashboard/**')).toBe(true)
    expect(matchesPathPattern('packages/api/src/index.ts', 'packages/dashboard/**')).toBe(false)
    expect(matchesPathPattern('src/a.ts', 'src/*.ts')).toBe(true)
    expect(matchesPathPattern('src/nested/a.ts', 'src/*.ts')).toBe(false)
  })

  test('isRuleApplicable resolves org/repo/path scopes', () => {
    const repoId = 'repo-1'
    const changedPaths = ['packages/api/src/review-runner.ts']
    const orgRule: RuleCandidate = {
      id: 'r1',
      name: 'Org Rule',
      content: 'Always do X',
      category: 'custom',
      severity: 'warning',
      scopeType: 'org',
      repoId: null,
      pathPattern: null,
    }
    const repoRule: RuleCandidate = { ...orgRule, id: 'r2', name: 'Repo Rule', scopeType: 'repo', repoId }
    const otherRepoRule: RuleCandidate = { ...repoRule, id: 'r3', repoId: 'repo-2' }
    const pathRule: RuleCandidate = { ...orgRule, id: 'r4', name: 'Path Rule', scopeType: 'path', pathPattern: 'packages/api/**' }

    expect(isRuleApplicable(orgRule, repoId, changedPaths)).toBe(true)
    expect(isRuleApplicable(repoRule, repoId, changedPaths)).toBe(true)
    expect(isRuleApplicable(otherRepoRule, repoId, changedPaths)).toBe(false)
    expect(isRuleApplicable(pathRule, repoId, changedPaths)).toBe(true)
  })

  test('extractRuleNameFromComment parses Rule marker', () => {
    const body = 'Issue summary\nRule: No Raw SQL\nMore details'
    expect(extractRuleNameFromComment(body)).toBe('No Raw SQL')
    expect(extractRuleNameFromComment('No marker')).toBeNull()
  })

  test('evaluateRuleSignals marks pass/fail from Rule marker', () => {
    const rules: RuleCandidate[] = [
      {
        id: 'r1',
        name: 'No Raw SQL',
        content: 'Use parameterized statements',
        category: 'security',
        severity: 'error',
        scopeType: 'org',
        repoId: null,
        pathPattern: null,
      },
      {
        id: 'r2',
        name: 'Require Tests',
        content: 'Critical behavior needs tests',
        category: 'testability',
        severity: 'warning',
        scopeType: 'org',
        repoId: null,
        pathPattern: null,
      },
    ]
    const signal = evaluateRuleSignals(rules, [
      { path: 'src/db.ts', line: 42, body: 'Issue details\nRule: No Raw SQL' },
    ])

    expect(signal.violations).toHaveLength(1)
    expect(signal.violations[0]?.ruleId).toBe('r1')
    expect(signal.evaluations).toEqual(
      expect.arrayContaining([
        { ruleId: 'r1', passed: false },
        { ruleId: 'r2', passed: true },
      ]),
    )
  })
})
