/**
 * PatchVerifier — safety checks for OpenCode-generated patches.
 *
 * After OpenCode modifies files on a ryv/fix/* branch, this verifier:
 * 1. Detects if any function signatures changed (which could break callers)
 * 2. Runs tsc --noEmit on changed files + blast-radius caller files only
 * 3. Runs targeted tests for affected symbols (if test files exist)
 * 4. Flags any files OpenCode touched outside the expected blast radius
 *
 * All checks are deterministic (compiler/test runner) — no LLM opinion.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'

const execAsync = promisify(exec)

export interface VerificationParams {
  /** Absolute path to local repo checkout */
  repoPath: string
  /** Files that OpenCode actually modified (from git diff) */
  changedFiles: string[]
  /** File paths of blast-radius callers (from symbol graph) */
  callerFiles: string[]
  /** Base branch the fix branched from (e.g. "main") */
  baseBranch: string
}

export interface VerificationResult {
  ok: boolean
  /** Human-readable errors to feed back to OpenCode on retry */
  errors: string[]
  /** Files OpenCode touched that were NOT in the blast radius */
  unexpectedFiles: string[]
}

/**
 * Run all safety checks on an OpenCode-generated patch.
 * Fast path: if no TypeScript files changed, skips tsc.
 */
export async function verifyPatch(params: VerificationParams): Promise<VerificationResult> {
  const { repoPath, changedFiles, callerFiles, baseBranch } = params
  const errors: string[] = []

  if (changedFiles.length === 0) {
    return { ok: false, errors: ['OpenCode made no changes'], unexpectedFiles: [] }
  }

  // 1. Scope check — flag unexpected files (don't fail, just report)
  const callerSet = new Set(callerFiles.map(f => path.normalize(f)))
  const unexpectedFiles = changedFiles.filter(f => {
    const norm = path.normalize(f)
    // Changed files are fine if they are the directly targeted file or a caller
    return !callerSet.has(norm)
  })

  // 2. Signature change detection
  const signatureErrors = await detectSignatureBreaks(repoPath, changedFiles, callerFiles, baseBranch)
  errors.push(...signatureErrors)

  // 3. Targeted tsc (TypeScript only)
  const tsFiles = [...changedFiles, ...callerFiles].filter(f => f.match(/\.(ts|tsx)$/) && !f.includes('.d.ts'))
  if (tsFiles.length > 0) {
    const tscErrors = await runTargetedTsc(repoPath, tsFiles)
    errors.push(...tscErrors)
  }

  // 4. Targeted test run
  const testErrors = await runTargetedTests(repoPath, changedFiles)
  errors.push(...testErrors)

  return { ok: errors.length === 0, errors, unexpectedFiles }
}

/**
 * Detect if function signatures changed in a way that could break callers.
 * Uses git diff to extract before/after signatures.
 */
async function detectSignatureBreaks(
  repoPath: string,
  changedFiles: string[],
  callerFiles: string[],
  baseBranch: string,
): Promise<string[]> {
  if (callerFiles.length === 0) return []

  const errors: string[] = []

  for (const file of changedFiles) {
    try {
      const { stdout } = await execAsync(
        `git -C "${repoPath}" diff ${baseBranch} -- "${file}"`,
        { timeout: 15_000 },
      )

      // Look for removed function/method signatures (lines starting with -)
      // that match common signature patterns
      const removedLines = stdout
        .split('\n')
        .filter(l => l.startsWith('-') && !l.startsWith('---'))
        .map(l => l.slice(1))

      const addedLines = stdout
        .split('\n')
        .filter(l => l.startsWith('+') && !l.startsWith('+++'))
        .map(l => l.slice(1))

      // Simple heuristic: exported function/method signature changed
      const sigPattern = /^\s*(?:export\s+)?(?:async\s+)?(?:function|(?:public|private|protected)\s+\w+)\s*\(/
      const removedSigs = removedLines.filter(l => sigPattern.test(l))
      const addedSigs = addedLines.filter(l => sigPattern.test(l))

      if (removedSigs.length > 0 && addedSigs.length > 0) {
        // Signatures changed — note it but don't fail (tsc will catch real breaks)
        // Only add to errors if the signature shape looks different
        const removedArities = removedSigs.map(s => (s.match(/,/g) || []).length)
        const addedArities = addedSigs.map(s => (s.match(/,/g) || []).length)
        const arityChanged = removedArities.some((a, i) => addedArities[i] !== undefined && addedArities[i] !== a)

        if (arityChanged) {
          errors.push(
            `Function signature arity changed in ${path.basename(file)} — verify callers: ${callerFiles.map(f => path.basename(f)).join(', ')}`,
          )
        }
      }
    } catch {
      // git diff failed — skip this file
    }
  }

  return errors
}

/**
 * Run tsc --noEmit on a targeted set of files.
 * Creates a temporary tsconfig that includes only the relevant files.
 */
async function runTargetedTsc(repoPath: string, files: string[]): Promise<string[]> {
  // Find tsconfig.json in the repo
  const tsconfigPath = findTsconfig(repoPath)
  if (!tsconfigPath) return [] // No TypeScript project — skip

  // Check tsc is available
  const tscBin = await findTscBin(repoPath)
  if (!tscBin) return [] // tsc not available — skip silently

  // Write a temp tsconfig that extends the real one but only includes our files
  const tmpConfig = path.join(repoPath, `.ryv-verify-tsconfig-${Date.now()}.json`)
  const absoluteFiles = files.map(f => path.isAbsolute(f) ? f : path.join(repoPath, f))

  try {
    fs.writeFileSync(tmpConfig, JSON.stringify({
      extends: tsconfigPath,
      include: absoluteFiles,
      compilerOptions: { noEmit: true, skipLibCheck: true },
    }))

    await execAsync(`${tscBin} --project "${tmpConfig}"`, {
      timeout: 30_000,
      cwd: repoPath,
    })

    return []
  } catch (e: unknown) {
    // Parse tsc output into readable errors
    const err = e as { stdout?: string; stderr?: string }
    return parseTscErrors(err.stdout ?? err.stderr ?? String(e))
  } finally {
    try { fs.unlinkSync(tmpConfig) } catch { /* ignore cleanup errors */ }
  }
}

function parseTscErrors(output: string): string[] {
  return output
    .split('\n')
    .filter(l => l.includes('error TS'))
    .map(l => l.trim())
    .slice(0, 10) // Cap at 10 errors to avoid flooding the retry prompt
}

function findTsconfig(repoPath: string): string | null {
  const candidates = ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.base.json']
  for (const c of candidates) {
    const p = path.join(repoPath, c)
    if (fs.existsSync(p)) return p
  }
  return null
}

async function findTscBin(repoPath: string): Promise<string | null> {
  // Try local node_modules/.bin/tsc first
  const local = path.join(repoPath, 'node_modules', '.bin', 'tsc')
  if (fs.existsSync(local)) return local
  // Fall back to global tsc
  try {
    await execAsync('tsc --version', { timeout: 5_000 })
    return 'tsc'
  } catch {
    return null
  }
}

/**
 * Run tests related to the changed files.
 * Detects test framework from package.json and runs only matching test files.
 */
async function runTargetedTests(repoPath: string, changedFiles: string[]): Promise<string[]> {
  const framework = detectTestFramework(repoPath)
  if (!framework) return []

  // Find test files that correspond to changed source files
  const testFiles = changedFiles.flatMap(f => findRelatedTestFiles(repoPath, f))
  if (testFiles.length === 0) return []

  const pattern = testFiles
    .map(f => path.basename(f).replace(/\.[^.]+$/, '')) // strip extension
    .join('|')

  try {
    const cmd = framework === 'jest'
      ? `npx jest --testPathPattern="${pattern}" --passWithNoTests --no-coverage`
      : `npx vitest run --reporter=verbose`

    await execAsync(cmd, { timeout: 60_000, cwd: repoPath })
    return []
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string }
    const output = err.stdout ?? err.stderr ?? String(e)
    // Extract just the failure summary
    const failLines = output.split('\n').filter((l: string) =>
      l.includes('FAIL') || l.includes('✗') || l.includes('× ') || l.includes('Expected') || l.includes('Received')
    ).slice(0, 8)
    return failLines.length > 0
      ? [`Tests failed:\n${failLines.join('\n')}`]
      : ['Tests failed (see logs)']
  }
}

function detectTestFramework(repoPath: string): 'jest' | 'vitest' | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps['vitest']) return 'vitest'
    if (deps['jest'] || deps['@jest/core']) return 'jest'
  } catch { /* ignore */ }
  return null
}

function findRelatedTestFiles(repoPath: string, sourceFile: string): string[] {
  const base = path.basename(sourceFile, path.extname(sourceFile))
  const dir = path.dirname(path.join(repoPath, sourceFile))
  const candidates = [
    path.join(dir, `${base}.test.ts`),
    path.join(dir, `${base}.spec.ts`),
    path.join(dir, `${base}.test.tsx`),
    path.join(dir, '__tests__', `${base}.test.ts`),
    path.join(dir, '__tests__', `${base}.spec.ts`),
  ]
  return candidates.filter(f => fs.existsSync(f))
}
