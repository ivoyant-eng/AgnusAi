import type { Diff, ReviewContext, SplitSuggestion } from '../types';
import type { LLMBackend } from '../llm/base';

function isSplitCandidate(diff: Diff, fileThreshold: number): boolean {
  const topDirs = new Set(diff.files.map((f) => f.path.split('/')[0]).filter(Boolean));
  const hasMigrations = diff.files.some((f) => f.path.toLowerCase().includes('migration'));
  const hasTests = diff.files.some((f) => /\.(test|spec)\./i.test(f.path));

  const conditions = [
    diff.changedFiles > fileThreshold,
    topDirs.size >= 3,
    hasMigrations && hasTests,
    diff.additions + diff.deletions > 800,
  ];
  return conditions.filter(Boolean).length >= 2;
}

function buildSplitPrompt(diff: Diff, context: ReviewContext): string {
  const fileList = diff.files.map((f) => f.path).join('\n');
  return [
    `This PR touches the following files:\n${fileList}`,
    `\nThe PR title is: ${context.pr.title}`,
    '\nDetermine if this PR should be split into smaller, focused PRs.',
    'If yes, name each suggested sub-PR and list its files.',
    '\nRespond ONLY in this format:',
    'SHOULD_SPLIT: yes|no',
    'REASON: <one sentence>',
    'SPLIT_1: <name> | <comma-separated file paths>',
    'SPLIT_2: <name> | <comma-separated file paths>',
    '(add more SPLIT_N lines as needed)',
  ].join('\n');
}

function parseSplitResponse(raw: string): SplitSuggestion | null {
  const shouldMatch = raw.match(/SHOULD_SPLIT:\s*(yes|no)/i);
  if (!shouldMatch) return null;

  const shouldSplit = shouldMatch[1].toLowerCase() === 'yes';
  if (!shouldSplit) return { shouldSplit: false, reason: 'PR is well-scoped.', suggestedSplits: [] };

  const reasonMatch = raw.match(/REASON:\s*(.+)/i);
  const reason = reasonMatch?.[1]?.trim() ?? 'PR touches many unrelated areas.';

  const suggestedSplits: Array<{ name: string; files: string[] }> = [];
  const splitRegex = /SPLIT_\d+:\s*(.+?)\s*\|\s*(.+)/gi;
  let m: RegExpExecArray | null;
  while ((m = splitRegex.exec(raw)) !== null) {
    suggestedSplits.push({
      name: m[1].trim(),
      files: m[2].split(',').map((f) => f.trim()).filter(Boolean),
    });
  }

  return { shouldSplit: true, reason, suggestedSplits };
}

async function runSplitLLM(
  llm: LLMBackend,
  diff: Diff,
  context: ReviewContext,
): Promise<SplitSuggestion | null> {
  try {
    const prompt = buildSplitPrompt(diff, context);
    const raw = await llm.generate(prompt, context);
    return parseSplitResponse(raw);
  } catch (err) {
    console.warn('[split-detector] LLM call failed:', (err as Error).message);
    return null;
  }
}

/**
 * Detects PRs that touch too many unrelated concerns and suggests how to split them.
 * Uses deterministic heuristics first — only invokes the LLM when heuristics fire.
 */
export async function detectSplit(
  llm: LLMBackend,
  diff: Diff,
  context: ReviewContext,
  fileThreshold = 15,
): Promise<SplitSuggestion | null> {
  if (!isSplitCandidate(diff, fileThreshold)) return null;
  console.log(`[split-detector] PR ${context.pr.number} is a split candidate — running LLM analysis`);
  return runSplitLLM(llm, diff, context);
}

export function formatSplitSuggestion(split: SplitSuggestion): string {
  if (!split.shouldSplit || split.suggestedSplits.length === 0) return '';

  const splitLines = split.suggestedSplits
    .map((s) => `- **\`${s.name}\`** — ${s.files.slice(0, 6).join(', ')}${s.files.length > 6 ? ', ...' : ''}`)
    .join('\n');

  return [
    '\n### ⚠️ Consider Splitting This PR\n',
    `${split.reason}\n`,
    '**Suggested splits:**',
    splitLines,
  ].join('\n');
}
