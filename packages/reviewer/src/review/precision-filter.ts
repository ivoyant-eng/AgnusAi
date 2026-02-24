// Precision filter - Filter review comments by confidence score
// Removes low-signal comments to reduce alert fatigue

import { ReviewComment } from '../types';

/**
 * Configuration for precision filtering
 */
export interface PrecisionFilterConfig {
  /** Minimum confidence threshold (0.0-1.0). Comments below this are filtered out. */
  minConfidence: number;
}

/**
 * Default precision filter configuration
 */
export const DEFAULT_PRECISION_CONFIG: PrecisionFilterConfig = {
  minConfidence: 0.7,
};

/**
 * Result of filtering comments by confidence
 */
export interface FilteredByConfidence {
  /** Comments that passed the confidence threshold */
  kept: ReviewComment[];
  /** Comments that were filtered out due to low confidence */
  filtered: ReviewComment[];
  /** Stats about the filtering */
  stats: {
    total: number;
    kept: number;
    filtered: number;
  };
}

/**
 * Filter comments by confidence score
 * Comments without confidence scores are kept (backward compatible)
 */
export function filterByConfidence(
  comments: ReviewComment[],
  config: PrecisionFilterConfig = DEFAULT_PRECISION_CONFIG
): FilteredByConfidence {
  const kept: ReviewComment[] = [];
  const filtered: ReviewComment[] = [];

  for (const comment of comments) {
    // Keep comments without confidence scores (backward compatibility)
    if (comment.confidence === undefined) {
      kept.push(comment);
      continue;
    }

    // Filter out low-confidence comments
    if (comment.confidence >= config.minConfidence) {
      kept.push(comment);
    } else {
      filtered.push(comment);
    }
  }

  return {
    kept,
    filtered,
    stats: {
      total: comments.length,
      kept: kept.length,
      filtered: filtered.length,
    },
  };
}

/**
 * Get filtered reason for a comment (for logging)
 */
export function getFilteredReason(comment: ReviewComment, minConfidence: number): string {
  return `confidence too low (${comment.confidence} < ${minConfidence})`;
}
