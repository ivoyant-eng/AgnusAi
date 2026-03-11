/**
 * Shared utilities for agentic command handlers.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import type { VCSAdapter } from '../../adapters/vcs/base'
import type { Diff } from '../../types'

const execAsync = promisify(exec)

export function hasAgenticSupport(vcs: VCSAdapter): boolean {
  return !!(vcs.createBranch && vcs.commitFiles && vcs.openPR)
}

export async function getLocalRepoPath(repoId: string, pool: unknown): Promise<string | null> {
  try {
    const db = pool as { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ repo_path: string | null }> }> }
    const res = await db.query('SELECT repo_path FROM repos WHERE repo_id = $1', [repoId])
    return res.rows[0]?.repo_path ?? null
  } catch {
    return null
  }
}

/**
 * Returns only the files OpenCode modified in the working tree (unstaged changes vs HEAD).
 * This gives us just the fix, not all the PR's pre-existing changes.
 */
export async function gitDiffFiles(repoPath: string, _baseBranch: string): Promise<string[]> {
  try {
    // Unstaged modified files
    const { stdout: modified } = await execAsync(
      `git -C "${repoPath}" diff --name-only HEAD`,
      { timeout: 15_000 },
    )
    // Untracked new files OpenCode may have created
    const { stdout: untracked } = await execAsync(
      `git -C "${repoPath}" ls-files --others --exclude-standard`,
      { timeout: 15_000 },
    )
    const files = [
      ...modified.trim().split('\n'),
      ...untracked.trim().split('\n'),
    ].filter(Boolean)
    return [...new Set(files)]
  } catch {
    return []
  }
}

/**
 * Build an authenticated git remote URL by embedding a token as a password.
 * Mirrors the logic in packages/api/src/git-utils.ts without creating a cross-package dep.
 */
export function buildAuthenticatedUrl(repoUrl: string, token: string): string {
  try {
    const url = new URL(repoUrl)
    if (repoUrl.includes('dev.azure.com')) {
      url.username = 'oauth2'
      url.password = token
    } else {
      url.username = 'x-access-token'
      url.password = token
    }
    return url.toString()
  } catch {
    return repoUrl
  }
}

export interface FixPromptParams {
  request: string
  prTitle: string
  prDescription: string
  diff: Diff
  graphContext: any
  baseBranch: string
  /** Absolute path to the isolated worktree where files must be edited */
  worktreePath: string
}

export function buildFixPrompt(p: FixPromptParams): string {
  const callerSection = p.graphContext?.blastRadius?.callers?.length
    ? `\n## Callers That Must Not Break\nThese functions call the changed symbol. Do not break their interfaces.\n\n${
        p.graphContext.blastRadius.callers
          .map((c: any) => `- ${c.name} in ${c.filePath}`)
          .join('\n')
      }`
    : ''

  const diffText = p.diff.files
    .flatMap(f => f.hunks.map(h => h.content))
    .join('\n')
    .slice(0, 8000)

  // Build list of files to edit with their full absolute paths
  const filePaths = p.diff.files.map(f => `- ${p.worktreePath}/${f.path.replace(/^\//, '')}`).join('\n')

  return [
    `## Working Directory`,
    `You are working in an isolated git checkout at: ${p.worktreePath}`,
    `CRITICAL: All file edits MUST use full absolute paths starting with ${p.worktreePath}/`,
    `Example: to edit notificationService.js, use path: ${p.worktreePath}/notificationService.js`,
    ``,
    `## Files to Edit`,
    filePaths,
    ``,
    `## Fix Request`,
    p.request,
    ``,
    `## PR Context`,
    `Title: ${p.prTitle}`,
    p.prDescription ? `Description: ${p.prDescription.slice(0, 500)}` : '',
    ``,
    `## Current Diff`,
    '```diff',
    diffText,
    '```',
    callerSection,
    ``,
    `## Instructions`,
    `- Fix ONLY what was requested. Do not refactor unrelated code.`,
    `- Make the minimal code change needed to address the request.`,
    `- Do not run tests, install packages, or execute any shell commands.`,
    `- Do not change function signatures unless strictly necessary.`,
    `- If you must change a signature, update all callers listed above.`,
  ].filter(Boolean).join('\n')
}

export interface TestPromptParams {
  request: string
  prTitle: string
  diff: Diff
  baseBranch: string
}

export function buildTestPrompt(p: TestPromptParams): string {
  const changedFunctions = p.diff.files
    .flatMap(f => f.hunks.map(h => `// ${f.path}\n${h.content}`))
    .join('\n')
    .slice(0, 8000)

  return [
    `## Test Generation Request`,
    p.request || 'Generate unit tests for the changed functions.',
    ``,
    `## Changed Code`,
    '```diff',
    changedFunctions,
    '```',
    ``,
    `## Instructions`,
    `- Write UNIT TESTS ONLY. Do NOT write integration tests.`,
    `- Do NOT make real HTTP requests. Mock all external dependencies.`,
    `- Do NOT connect to real databases. Use in-memory or mock data.`,
    `- Detect the test framework from package.json (jest/vitest/mocha).`,
    `- Place test files next to source files: foo.ts → foo.test.ts`,
    `- Run the tests after writing them. Fix any failures before finishing.`,
    `- Aim for meaningful coverage of edge cases, not just happy paths.`,
  ].join('\n')
}

/**
 * Poll git diff --stat HEAD in a worktree every `intervalMs` ms until the output
 * is identical for `stableRounds` consecutive rounds (OpenCode has stopped writing)
 * or `maxAttempts` is exhausted (timeout).
 *
 * Returns as soon as stable — used as the completion signal instead of fragile SSE.
 */
export async function pollUntilStable(
  repoPath: string,
  intervalMs = 30_000,
  maxAttempts = 20,
  stableRounds = 2,
): Promise<{ stable: boolean; timedOut: boolean }> {
  let lastStat = ''
  let consecutiveStable = 0

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    try {
      const { stdout } = await execAsync(`git -C "${repoPath}" diff --stat HEAD`, { timeout: 10_000 })
      const current = stdout.trim()
      if (current === lastStat && current !== '') {
        consecutiveStable++
        if (consecutiveStable >= stableRounds) return { stable: true, timedOut: false }
      } else {
        consecutiveStable = 0
        lastStat = current
      }
    } catch {
      consecutiveStable = 0
    }
  }
  return { stable: false, timedOut: true }
}

/** Minimal OpenCode HTTP call — shared by fix and test handlers */
export async function callOpenCode(
  baseUrl: string,
  password: string,
  repoPath: string,
  prompt: string,
  timeoutMs = 600_000,
): Promise<{ output: string; timedOut: boolean }> {
  const authHeader = password
    ? `Basic ${Buffer.from(`:${password}`).toString('base64')}`
    : ''

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authHeader) headers['Authorization'] = authHeader

  // Create session (5s timeout — OpenCode must be responsive)
  const sessionAbort = new AbortController()
  const sessionTimer = setTimeout(() => sessionAbort.abort(), 5_000)
  const sessionRes = await fetch(`${baseUrl}/session?directory=${encodeURIComponent(repoPath)}`, {
    method: 'POST', headers, body: '{}', signal: sessionAbort.signal,
  }).finally(() => clearTimeout(sessionTimer))
  if (!sessionRes.ok) throw new Error(`OpenCode session error: ${sessionRes.status}`)
  const session = await sessionRes.json() as { id: string }

  // Send message — OpenCode API requires parts array + model object.
  // POST may block until the task completes; cap it at timeoutMs so we don't hang forever.
  const providerID = process.env.OPENCODE_PROVIDER_ID ?? 'opencode'
  const modelID = process.env.OPENCODE_MODEL_ID ?? 'big-pickle'
  const msgAbort = new AbortController()
  const msgTimer = setTimeout(() => msgAbort.abort(), timeoutMs)
  let msgData: { parts?: Array<{ type: string; text?: string }> } = {}
  try {
    const msgRes = await fetch(`${baseUrl}/session/${session.id}/message`, {
      method: 'POST', headers, signal: msgAbort.signal,
      body: JSON.stringify({
        parts: [{ type: 'text', text: prompt }],
        model: { providerID, modelID },
      }),
    })
    msgData = await msgRes.json().catch(() => ({})) as { parts?: Array<{ type: string; text?: string }> }
  } catch {
    // POST timed out or failed — fall through to SSE stream
  } finally {
    clearTimeout(msgTimer)
  }
  const inlineText = (msgData.parts ?? [])
    .filter((p: { type: string; text?: string }) => p.type === 'text' && p.text)
    .map((p: { type: string; text?: string }) => p.text as string)
    .join('')
  if (inlineText) return { output: inlineText, timedOut: false }

  // Helper: ask OpenCode to abort/delete the session (best-effort cleanup)
  const cleanupSession = () => {
    fetch(`${baseUrl}/session/${session.id}`, { method: 'DELETE', headers }).catch(() => {})
  }

  // Fallback: stream SSE until done. OpenCode events use { payload: { type, properties } }.
  return new Promise((resolve) => {
    const parts: string[] = []
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        cleanupSession()
        resolve({ output: parts.join(''), timedOut: true })
      }
    }, timeoutMs)

    const evtHeaders: Record<string, string> = { Accept: 'text/event-stream' }
    if (authHeader) evtHeaders['Authorization'] = authHeader

    fetch(`${baseUrl}/global/event`, { headers: evtHeaders })
      .then(async (res) => {
        if (!res.body) { if (!settled) { settled = true; clearTimeout(timeout); resolve({ output: '', timedOut: false }) } return }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n'); buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6))
              // OpenCode SSE format: { payload: { type, properties } }
              const evType = ev.payload?.type ?? ev.type
              const evSid = ev.payload?.properties?.sessionID ?? ev.payload?.properties?.info?.sessionID
              // Only act on events from our session
              if (evSid && evSid !== session.id) continue
              if (evType === 'message.part.updated') {
                const part = ev.payload?.properties?.part
                if (part?.type === 'text' && part?.content) parts.push(part.content)
              }
              if (evType === 'session.idle' || evType === 'session.complete') {
                if (!settled) { settled = true; clearTimeout(timeout); resolve({ output: parts.join(''), timedOut: false }) }
              }
            } catch { /* skip */ }
          }
        }
        if (!settled) { settled = true; clearTimeout(timeout); resolve({ output: parts.join(''), timedOut: false }) }
      })
      .catch(() => { if (!settled) { settled = true; clearTimeout(timeout); resolve({ output: parts.join(''), timedOut: false }) } })
  })
}
