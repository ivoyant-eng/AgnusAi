import type { VCSAdapter } from '../adapters/vcs/base';
import type { Diff } from '../types';

/**
 * Strip YAML frontmatter (--- ... ---) from markdown content.
 * Returns only the body below the frontmatter block.
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

/**
 * Loads .agnus/best_practices.md files from the repository and merges them.
 *
 * Resolution order:
 *   1. .agnus/best_practices.md  (repo root — always checked)
 *   2. .agnus/{topLevelDir}/best_practices.md  (per changed top-level directory)
 *
 * Files that don't exist are silently skipped.
 * Content is concatenated with a horizontal rule separator.
 */
export async function loadBestPractices(
  vcs: VCSAdapter,
  diff: Diff,
  branch: string,
  maxChars = 3000,
): Promise<string> {
  const candidates: string[] = ['.agnus/best_practices.md'];

  // Per-directory candidates based on changed files
  const topDirs = new Set(
    diff.files.map((f) => f.path.split('/')[0]).filter((d) => Boolean(d) && !d.startsWith('.')),
  );
  for (const dir of topDirs) {
    candidates.push(`.agnus/${dir}/best_practices.md`);
  }

  const sections: string[] = [];
  for (const candidate of candidates) {
    try {
      const raw = await vcs.getFileContent(candidate, branch);
      if (!raw) continue;
      const body = stripFrontmatter(raw);
      if (body) sections.push(body);
    } catch {
      // File not found or fetch failed — skip silently
    }
  }

  if (sections.length === 0) return '';

  const merged = sections.join('\n\n---\n\n');
  return merged.length > maxChars ? merged.slice(0, maxChars) + '\n\n... [best_practices truncated]' : merged;
}
