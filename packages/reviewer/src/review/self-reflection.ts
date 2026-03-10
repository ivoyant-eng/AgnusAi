import type { ReviewComment, ReviewContext } from '../types';
import type { LLMBackend } from '../llm/base';

function buildReflectionPrompt(comments: ReviewComment[]): string {
  const numbered = comments
    .map((c, i) => `${i + 1}. [${c.path}:${c.line}] ${c.body.split('\n')[0].slice(0, 200)}`)
    .join('\n');

  return [
    'You are a skeptical senior engineer trying to REJECT AI-generated code review comments.',
    'For each finding, your job is to find a reason why it is wrong, speculative, or not worth posting.',
    'Only score a finding HIGH if you CANNOT find a valid objection to it.',
    '',
    'Scoring guide — assign 0–10 per finding:',
    '- 9–10: You tried hard to disprove it and could not. Concrete bug or security issue with direct diff evidence.',
    '- 7–8: You found no strong objection. Likely real issue, well-evidenced.',
    '- 4–6: You found a plausible objection (speculative, stylistic, or missing context). Borderline.',
    '- 0–3: You found a clear reason to reject it — too vague, cannot be confirmed from the diff, hedging language, or addresses a non-issue.',
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
