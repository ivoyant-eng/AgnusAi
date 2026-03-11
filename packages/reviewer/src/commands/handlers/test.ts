/**
 * Test command handler — @ryv generate test / @ryv write tests
 *
 * Generates UNIT TESTS ONLY for changed functions.
 * Never generates integration tests (no real HTTP, no real DB).
 * Opens a companion PR with the test file.
 */

import type { CommandHandler } from '../types'
import { buildTestPrompt, getLocalRepoPath, gitDiffFiles, hasAgenticSupport, callOpenCode } from './shared'

export const handleTest: CommandHandler = async (ctx, intent, vcs, llm, graphEntry) => {
  if (!hasAgenticSupport(vcs)) {
    return { reply: '**@ryv** Test generation PRs are not yet supported for this VCS platform.' }
  }

  const repoPath = await getLocalRepoPath(ctx.repoId, ctx.pool)
  if (!repoPath) {
    return { reply: '**@ryv** Cannot generate tests — repo not indexed locally.' }
  }

  const diff = await vcs.getDiff(ctx.prNumber)
  const pr = await vcs.getPR(ctx.prNumber)

  const prompt = buildTestPrompt({
    request: intent.query,
    prTitle: pr.title,
    diff,
    baseBranch: ctx.baseBranch,
  })

  const OPENCODE_URL = process.env.OPENCODE_URL ?? 'http://opencode:4096'
  const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? ''

  let result: { output: string; timedOut: boolean }
  try {
    result = await callOpenCode(OPENCODE_URL, OPENCODE_PASSWORD, repoPath, prompt)
  } catch (err: any) {
    return { reply: `**@ryv** OpenCode is not available: ${err.message}` }
  }

  if (result.timedOut) {
    return { reply: '**@ryv** Test generation timed out.' }
  }

  const changedFiles = await gitDiffFiles(repoPath, ctx.baseBranch)
  const testFiles = changedFiles.filter(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'))

  if (testFiles.length === 0) {
    return { reply: '**@ryv** OpenCode ran but no test files were created. Try: `@ryv generate unit tests for the changed functions`' }
  }

  const shortDesc = diff.files[0]?.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'code'
  const branchName = `ryv/test/${ctx.prNumber}-${shortDesc}`

  try {
    await vcs.createBranch!(branchName, ctx.baseBranch)

    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const files = changedFiles.map(f => ({
      path: f,
      content: readFileSync(join(repoPath, f), 'utf8'),
    }))

    await vcs.commitFiles!(branchName, files, `test: add unit tests for ${shortDesc}`)

    const newPR = await vcs.openPR!({
      title: `test: add unit tests for ${shortDesc}`,
      body: [
        '## Ryv Generated Tests',
        '',
        `**Triggered by:** \`@ryv ${intent.query}\` on #${ctx.prNumber}`,
        '',
        '### Test Files',
        testFiles.map(f => `- \`${f}\``).join('\n'),
        '',
        '> These are unit tests only. Review before merging.',
        '',
        '---',
        '*Generated autonomously by Ryv.*',
      ].join('\n'),
      head: branchName,
      base: ctx.baseBranch,
    })

    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    await execAsync(`git -C "${repoPath}" checkout ${ctx.baseBranch}`, { timeout: 15_000 }).catch(() => {})

    return {
      reply: `**@ryv** Test PR opened: ${newPR.url}\n\n` +
        `Created ${testFiles.length} test file(s): ${testFiles.map(f => `\`${f}\``).join(', ')}`,
    }
  } catch (err: any) {
    return { reply: `**@ryv** Could not open test PR: ${err.message}` }
  }
}
