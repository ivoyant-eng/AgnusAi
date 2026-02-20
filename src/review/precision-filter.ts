/**
 * Precision Filter - P1: Precision-First Output
 * 
 * Filters comments by confidence threshold to reduce alert fatigue.
 * If no comments clear the threshold, return "No significant issues found".
 * 
 * Research shows AI review tools score 39-49% F1 on real PRs.
 * Once trust is lost, up to 40% of AI alerts are ignored.
 * This filter addresses the root cause by only surfacing high-confidence signals.
 */

import { ReviewComment } from '../types';

export interface PrecisionFilterResult {
  /** Comments that passed the threshold */
  passed: ReviewComment[];
  /** Comments that were filtered out */
  dropped: ReviewComment[];
  /** Summary message if nothing passed */
  emptyMessage?: string;
}

export interface PrecisionFilterConfig {
  /** Minimum confidence to pass (0.0-1.0), default 0.7 */
  threshold: number;
  /** Whether to log dropped comments for debugging */
  logDropped: boolean;
}

const DEFAULT_CONFIG: PrecisionFilterConfig = {
  threshold: 0.7,
  logDropped: false,
};

/**
 * Filter comments by confidence threshold.
 * Comments below threshold are silently dropped.
 * Returns empty message if nothing passes.
 */
export function filterByConfidence(
  comments: ReviewComment[],
  config: Partial<PrecisionFilterConfig> = {}
): PrecisionFilterResult {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const { threshold, logDropped } = finalConfig;

  const passed: ReviewComment[] = [];
  const dropped: ReviewComment[] = [];

  for (const comment of comments) {
    // Default to 0.5 confidence if not specified (neutral)
    const confidence = comment.confidence ?? 0.5;

    if (confidence >= threshold) {
      passed.push(comment);
    } else {
      dropped.push(comment);
      if (logDropped) {
        console.log(
          `[PrecisionFilter] Dropped comment (confidence: ${confidence.toFixed(2)} < ${threshold}): ${comment.path}:${comment.line}`
        );
      }
    }
  }

  // If nothing passed, return empty message
  const emptyMessage = passed.length === 0 
    ? '## ✅ No significant issues found\n\nAll identified issues had low confidence scores. The PR appears to be in good shape.'
    : undefined;

  return {
    passed,
    dropped,
    emptyMessage,
  };
}

/**
 * Calculate precision metrics for tracking.
 * Should be called after review to track effectiveness.
 */
export function calculatePrecisionMetrics(
  result: PrecisionFilterResult
): {
  total: number;
  passed: number;
  dropped: number;
  passRate: number;
} {
  const total = result.passed.length + result.dropped.length;
  const passed = result.passed.length;
  const dropped = result.dropped.length;
  const passRate = total > 0 ? passed / total : 0;

  return {
    total,
    passed,
    dropped,
    passRate,
  };
}

/**
 * Estimate confidence for a comment based on heuristics.
 * Used when LLM doesn't provide explicit confidence score.
 */
export function estimateConfidence(comment: ReviewComment): number {
  // Start with neutral confidence
  let score = 0.5;

  // Severity indicates confidence
  if (comment.severity === 'error') score += 0.15;
  if (comment.severity === 'warning') score += 0.05;
  if (comment.severity === 'info') score -= 0.05;

  // Has suggestion indicates higher confidence
  if (comment.suggestion) score += 0.1;

  // Body length indicators
  if (comment.body.length > 200) score += 0.05;
  if (comment.body.length > 500) score += 0.05;

  // Contains reproduction steps (high value)
  if (comment.body.toLowerCase().includes('reproduction')) score += 0.1;

  // Contains code example
  if (comment.body.includes('```')) score += 0.05;

  // Clamp to valid range
  return Math.max(0.0, Math.min(1.0, score));
}