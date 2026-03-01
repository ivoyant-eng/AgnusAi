import type { RuleCategory, RuleScopeType, RuleSeverity } from '@agnus-ai/shared'

export interface RuleCandidate {
  id: string
  name: string
  content: string
  category: RuleCategory
  severity: RuleSeverity
  scopeType: RuleScopeType
  repoId: string | null
  pathPattern: string | null
}

export interface RuleViolationSignal {
  ruleId: string
  filePath: string | null
  lineNumber: number | null
  commentBody: string
}

export interface RuleEvaluationSignal {
  evaluations: Array<{ ruleId: string; passed: boolean }>
  violations: RuleViolationSignal[]
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function compileGlobPattern(pattern: string): RegExp {
  const normalized = pattern.trim().replace(/\\/g, '/')
  let regex = '^'
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        regex += '.*'
        i++
      } else {
        regex += '[^/]*'
      }
      continue
    }
    if (ch === '?') {
      regex += '.'
      continue
    }
    regex += escapeRegex(ch)
  }
  regex += '$'
  return new RegExp(regex)
}

export function matchesPathPattern(filePath: string, pathPattern: string): boolean {
  if (!pathPattern?.trim()) return false
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '')
  const regex = compileGlobPattern(pathPattern)
  return regex.test(normalizedPath) || regex.test(`/${normalizedPath}`)
}

export function isRuleApplicable(rule: RuleCandidate, repoId: string, changedPaths: string[]): boolean {
  if (rule.scopeType === 'org') return true
  if (rule.scopeType === 'repo') return rule.repoId === repoId
  if (rule.scopeType !== 'path') return false
  if (rule.repoId && rule.repoId !== repoId) return false
  if (!rule.pathPattern) return false
  return changedPaths.some(p => matchesPathPattern(p, rule.pathPattern as string))
}

export function extractRuleNameFromComment(body: string): string | null {
  const match = body.match(/\bRule\s*:\s*([^\n\r]+)/i)
  return match?.[1]?.trim() || null
}

export function evaluateRuleSignals(
  rules: RuleCandidate[],
  comments: Array<{ path?: string; line?: number; body?: string }>,
): RuleEvaluationSignal {
  const normalized = new Map<string, RuleCandidate>()
  for (const rule of rules) {
    normalized.set(rule.name.trim().toLowerCase(), rule)
  }

  const violatedRuleIds = new Set<string>()
  const violations: RuleViolationSignal[] = []

  for (const comment of comments) {
    const body = (comment.body ?? '').trim()
    if (!body) continue
    const extractedName = extractRuleNameFromComment(body)
    if (!extractedName) continue
    const matched = normalized.get(extractedName.toLowerCase())
    if (!matched) continue
    violatedRuleIds.add(matched.id)
    violations.push({
      ruleId: matched.id,
      filePath: comment.path ?? null,
      lineNumber: Number.isFinite(comment.line) ? Number(comment.line) : null,
      commentBody: body,
    })
  }

  return {
    evaluations: rules.map(rule => ({
      ruleId: rule.id,
      passed: !violatedRuleIds.has(rule.id),
    })),
    violations,
  }
}
