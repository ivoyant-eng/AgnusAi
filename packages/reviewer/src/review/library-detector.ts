import fs from 'fs/promises'
import path from 'path'
import type { Diff } from '../types'

/**
 * Matches import/require specifiers in diff hunk content.
 * Handles:
 *   import ... from 'library'
 *   import('library')
 *   require('library')
 */
const IMPORT_RE = /(?:from\s+['"]|import\s*\(\s*['"]|require\s*\(\s*['"])([^'"]+)['"]/g

/**
 * Strips path segments to get the package name.
 * '@scope/pkg/sub' → '@scope/pkg'
 * 'pkg/sub/path'   → 'pkg'
 * './relative'     → null (skipped)
 */
function extractPackageName(specifier: string): string | null {
  if (specifier.startsWith('.')) return null

  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
    return null
  }

  return specifier.split('/')[0] ?? null
}

/**
 * Detects external npm libraries referenced in the PR diff and resolves their installed
 * versions from the project's package.json.
 *
 * Returns a Map<libraryName, installedVersion> for all detected external dependencies.
 * Libraries not found in package.json are included with version = undefined.
 */
export async function detectLibrariesInDiff(
  diff: Diff,
  repoPath: string,
): Promise<Map<string, string | undefined>> {
  const libraries = new Set<string>()

  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      IMPORT_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = IMPORT_RE.exec(hunk.content)) !== null) {
        const pkg = extractPackageName(match[1])
        if (pkg) libraries.add(pkg)
      }
    }
  }

  if (libraries.size === 0) return new Map()

  // Read package.json to resolve installed versions
  const allDeps: Record<string, string> = {}
  try {
    const raw = await fs.readFile(path.join(repoPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    // Merge all dep buckets; dependencies wins over devDeps wins over peerDeps
    Object.assign(allDeps, pkg.peerDependencies ?? {}, pkg.devDependencies ?? {}, pkg.dependencies ?? {})
  } catch {
    // No package.json or unreadable — return versions as undefined
  }

  const result = new Map<string, string | undefined>()
  for (const lib of libraries) {
    const rawVersion = allDeps[lib]
    // Strip semver range prefix: ^1.2.3 | ~1.2.3 | >=1.2.3 → 1.2.3
    const version = rawVersion ? rawVersion.replace(/^[\^~>=<*]+/, '').trim() || undefined : undefined
    result.set(lib, version)
  }
  return result
}
