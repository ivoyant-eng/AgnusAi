import type { ReviewComment, ReviewContext } from '../types';
import type { LLMBackend } from '../llm/base';

function buildReflectionPrompt(comments: ReviewComment[]): string {
  const numbered = comments
    .map((c, i) => {
      // Pass the full comment body — truncation hides evidence and causes under-scoring.
      // Strip feedback links and HTML tags so the scorer focuses on substance.
      const cleanBody = c.body
        .replace(/\n---\nWas this helpful\?.*$/s, '') // strip feedback links
        .replace(/<[^>]+>/g, '')                       // strip HTML tags
        .trim()
      return `${i + 1}. [${c.path}:${c.line}]\n   ${cleanBody.replace(/\n/g, '\n   ')}`
    })
    .join('\n\n');

  return [
    'You are a senior engineer quality-checking AI-generated code review comments before they are posted.',
    'Your goal is to catch comments that are vague, speculative, stylistic, or unsupported — while keeping',
    'comments that identify real bugs, security issues, or correctness problems with concrete evidence.',
    '',
    'Scoring guide — assign 0–10 per finding:',
    '- 9–10: Concrete bug or security issue with direct, specific evidence. You cannot find a valid objection.',
    '- 7–8: Likely real issue, well-evidenced. Minor uncertainty at most.',
    '- 5–6: Plausible issue but evidence is indirect or requires assumptions.',
    '- 3–4: Speculative, stylistic preference, or missing key context to confirm.',
    '- 0–2: Vague, unverifiable, addresses a non-issue, or is pure style/readability noise.',
    '',
    'Security and correctness bugs with specific line references should score 8–10 unless clearly wrong.',
    'Style, naming, and readability comments should score 0–3 regardless of confidence.',
    '',
    'Respond ONLY in this format (one number per finding, comma-separated, same order as input):',
    'SCORES: 8, 3, 9, 2, 7',
    '',
    'Findings:',
    numbered,
  ].join('\n');
}

function parseScores(raw: string, expectedCount: number): number[] | null {
  const match = raw.match(/SCORES:\s*([\d,\s]+)/i);
  if (!match) return null;
  const scores = match[1]
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v));
  if (scores.length !== expectedCount) return null;
  return scores;
}

/**
 * Second-pass LLM re-scoring: assigns an independent quality score to each comment
 * and drops those below the threshold. Reduces false-positive noise without extra training.
 *
 * minSurvivors guarantees at least N comments always survive — prevents the pipeline
 * from returning 0 results when agents produced lower-quality evidence in a given run.
 * If threshold filtering would drop everything, the top minSurvivors by score are kept.
 *
 * Disabled by default. Enable via selfReflectionEnabled: true in ReviewConfig
 * or SELF_REFLECTION_ENABLED=true env var.
 */
export async function runSelfReflection(
  llm: LLMBackend,
  context: ReviewContext,
  comments: ReviewComment[],
  threshold = 5,
  minSurvivors = 1,
): Promise<ReviewComment[]> {
  if (comments.length === 0) return comments;

  let raw: string;
  try {
    const prompt = buildReflectionPrompt(comments);
    raw = await llm.generate(prompt, context, 0);
  } catch (err) {
    console.warn('[self-reflection] LLM call failed — passing comments through unchanged:', (err as Error).message);
    return comments;
  }

  const scores = parseScores(raw, comments.length);
  if (!scores) {
    console.warn('[self-reflection] Could not parse SCORES from LLM response — passing through unchanged');
    return comments;
  }

  // Pair each comment with its score for sorting
  const scored = comments.map((comment, i) => ({ comment, score: scores[i] ?? 0 }));
  const aboveThreshold = scored.filter(({ score }) => score >= threshold);

  // Guarantee floor: if threshold drops everything, keep the best minSurvivors by score
  const survivors =
    aboveThreshold.length >= minSurvivors
      ? aboveThreshold
      : [...scored].sort((a, b) => b.score - a.score).slice(0, minSurvivors);

  const dropped = comments.length - survivors.length;
  if (dropped > 0) {
    console.log(`[self-reflection] Dropped ${dropped}/${comments.length} low-quality comments (threshold=${threshold}, minSurvivors=${minSurvivors})`);
  }

  return survivors.map(({ comment, score }) => ({ ...comment, confidence: score / 10 }));
}
