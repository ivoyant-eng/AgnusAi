/**
 * consolidate.ts
 *
 * Deterministic (zero-LLM) post-pipeline pass that:
 *   1. Deduplicates findings by file region (±LINE_PROXIMITY lines, same semantic theme)
 *   2. Enforces a severity budget — errors: unlimited, warnings: max N, info: max N
 *
 * Runs AFTER all LLM passes (agents, judge, self-reflection, precision filter)
 * and BEFORE prScore computation, so the score is computed on stable output.
 */

import type { ReviewComment } from '../types';

const LINE_PROXIMITY = 15;
const MAX_WARNINGS = 5;
const MAX_INFO = 3;

/**
 * Minimum confidence required for an error-labeled finding to bypass the
 * warning budget cap. Below this threshold the LLM's "error" label is
 * treated as an inflated warning and competes in the warning pool instead.
 *
 * Rationale: genuine breaking errors (crashes, exploits, data loss) are
 * flagged with high confidence because the evidence is concrete in the diff.
 * Speculative "you should validate X" findings rarely exceed 0.8 confidence.
 */
const ERROR_CONFIDENCE_FLOOR = 0.85;

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityWeight(sev: string | undefined): number {
  switch (sev) {
    case 'error': return 3;
    case 'warning': return 2;
    case 'info': return 1;
    default: return 1;
  }
}

function commentScore(c: ReviewComment): number {
  return severityWeight(c.severity) * 10 + (c.confidence ?? 0.5) * 10;
}

/**
 * Extract significant terms from a comment body for semantic overlap detection.
 * Pulls backtick-wrapped identifiers + camelCase/snake_case words.
 */
function extractTerms(body: string): Set<string> {
  const terms = new Set<string>();
  // Backtick-wrapped identifiers
  const backticks = body.match(/`([^`]+)`/g) || [];
  for (const m of backticks) {
    const t = m.replace(/`/g, '').trim().toLowerCase();
    if (t.length >= 2) terms.add(t);
  }
  // camelCase, PascalCase, snake_case words (≥4 chars)
  const codeWords = body.replace(/`[^`]*`/g, '').match(/\b[a-zA-Z_][a-zA-Z0-9_]{3,}\b/g) || [];
  for (const w of codeWords) terms.add(w.toLowerCase());
  return terms;
}

/**
 * Two comments are semantically similar if ≥40% of the smaller term set overlaps,
 * OR if their first-line normalized text is identical.
 */
function isSameTheme(a: ReviewComment, b: ReviewComment): boolean {
  const termsA = extractTerms(a.body);
  const termsB = extractTerms(b.body);

  if (termsA.size > 0 && termsB.size > 0) {
    let overlap = 0;
    for (const t of termsA) { if (termsB.has(t)) overlap++; }
    const smaller = Math.min(termsA.size, termsB.size);
    if (overlap >= Math.max(1, Math.ceil(smaller * 0.4))) return true;
  }

  // Fallback: normalized first-line comparison
  const normA = normalizeFirstLine(a.body);
  const normB = normalizeFirstLine(b.body);
  return normA.length > 10 && normA === normB;
}

function normalizeFirstLine(body: string): string {
  return body
    .split('\n')[0]
    .replace(/<[^>]+>/g, '')
    .replace(/\*+/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\[Confidence:[^\]]+\]/gi, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Step 1: Region Dedup ─────────────────────────────────────────────────────

interface Region {
  file: string;
  lineStart: number;
  lineEnd: number;
  comments: ReviewComment[];
}

/**
 * Groups comments into regions: same file, lines within ±LINE_PROXIMITY.
 * Within each region, deduplicates by semantic theme — keeps highest-scoring
 * comment per theme. Different themes in the same region both survive.
 */
function deduplicateByRegion(comments: ReviewComment[]): ReviewComment[] {
  // Group by file
  const byFile = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const key = c.path ?? '';
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(c);
  }

  const result: ReviewComment[] = [];

  for (const [, fileComments] of byFile) {
    // Sort by line
    const sorted = [...fileComments].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

    // Build regions — merge comments within LINE_PROXIMITY
    const regions: Region[] = [];
    for (const c of sorted) {
      const line = c.line ?? 0;
      const last = regions[regions.length - 1];
      if (last && last.file === (c.path ?? '') && line <= last.lineEnd + LINE_PROXIMITY) {
        last.lineEnd = Math.max(last.lineEnd, line);
        last.comments.push(c);
      } else {
        regions.push({ file: c.path ?? '', lineStart: line, lineEnd: line, comments: [c] });
      }
    }

    // Within each region, keep best comment per unique theme
    for (const region of regions) {
      const bestByTheme: ReviewComment[] = [];
      // Sort by score descending — first seen theme wins
      const ranked = [...region.comments].sort((a, b) => commentScore(b) - commentScore(a));

      for (const c of ranked) {
        const isDuplicate = bestByTheme.some(kept => isSameTheme(kept, c));
        if (!isDuplicate) {
          bestByTheme.push(c);
        }
      }
      result.push(...bestByTheme);
    }
  }

  return result;
}

// ── Step 2: Severity Budget ──────────────────────────────────────────────────

/**
 * Enforces output budget with confidence-gated error classification:
 *
 *   - True errors (severity=error AND confidence ≥ ERROR_CONFIDENCE_FLOOR):
 *       ship unconditionally — no cap. These are concrete, high-evidence issues.
 *
 *   - Demoted errors (severity=error BUT confidence < ERROR_CONFIDENCE_FLOOR):
 *       treated as high-priority warnings. They join the warning pool but are
 *       sorted before regular warnings so they're picked first if budget allows.
 *       Prevents LLM severity inflation from bypassing the cap.
 *
 *   - Warnings: max MAX_WARNINGS (includes demoted errors), sorted by confidence desc
 *   - Info: max MAX_INFO, sorted by confidence desc
 */
function enforceBudget(comments: ReviewComment[]): ReviewComment[] {
  const trueErrors: ReviewComment[] = [];
  const warningPool: ReviewComment[] = [];  // warnings + demoted errors
  const infos: ReviewComment[] = [];

  for (const c of comments) {
    if (c.severity === 'error') {
      if ((c.confidence ?? 0) >= ERROR_CONFIDENCE_FLOOR) {
        trueErrors.push(c);
      } else {
        // Demote: keep original severity label so the comment body is unchanged,
        // but compete in the warning budget
        warningPool.push(c);
      }
    } else if (c.severity === 'warning') {
      warningPool.push(c);
    } else {
      infos.push(c);
    }
  }

  // Sort by confidence desc — demoted errors naturally float to the top of the
  // warning pool since they tend to have higher confidence than plain warnings
  const byConf = (a: ReviewComment, b: ReviewComment) => (b.confidence ?? 0) - (a.confidence ?? 0);
  warningPool.sort(byConf);
  infos.sort(byConf);

  const keptWarnings = warningPool.slice(0, MAX_WARNINGS);
  const keptInfos = infos.slice(0, MAX_INFO);

  const kept = [...trueErrors, ...keptWarnings, ...keptInfos];

  const demoted = warningPool.filter(c => c.severity === 'error').length;
  const dropped = comments.length - kept.length;

  if (demoted > 0) {
    console.log(`[consolidate] ${demoted} low-confidence error(s) demoted to warning pool (confidence < ${ERROR_CONFIDENCE_FLOOR})`);
  }
  if (dropped > 0) {
    console.log(`[consolidate] Budget enforced: ${kept.length} kept (${trueErrors.length} true errors, ${keptWarnings.length} warnings, ${keptInfos.length} info), ${dropped} dropped`);
  }

  return kept;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Deterministic consolidation pass. Call after all LLM-based filtering.
 * Returns a stable, deduplicated, budget-enforced comment list.
 */
export function consolidateFindings(comments: ReviewComment[]): ReviewComment[] {
  if (comments.length === 0) return comments;

  const deduped = deduplicateByRegion(comments);
  const budgeted = enforceBudget(deduped);

  if (deduped.length !== comments.length || budgeted.length !== deduped.length) {
    console.log(`[consolidate] ${comments.length} → ${deduped.length} (region dedup) → ${budgeted.length} (budget)`);
  }

  return budgeted;
}
