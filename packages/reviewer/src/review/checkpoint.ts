/**
 * Checkpoint Management for Incremental PR Reviews
 * 
 * This module handles storing and retrieving review checkpoints.
 * Checkpoints are stored in PR comments as hidden HTML metadata,
 * allowing us to track what was last reviewed and only review new changes.
 */

import { ReviewCheckpoint, PRComment } from '../types';

/**
 * Marker prefix for identifying checkpoint comments
 */
export const CHECKPOINT_MARKER = '<!-- AGNUSAI_CHECKPOINT:';

/**
 * Marker suffix for checkpoint comments
 */
export const CHECKPOINT_SUFFIX = ' -->';

/**
 * User agent name for checkpoint comments
 */
export const CHECKPOINT_USER_AGENT = 'agnus-ai[bot]';

/**
 * Parse a checkpoint from a comment body
 * 
 * @param commentBody The body of the PR comment
 * @returns The parsed checkpoint or null if not found/invalid
 */
export function parseCheckpoint(commentBody: string): ReviewCheckpoint | null {
  const startIndex = commentBody.indexOf(CHECKPOINT_MARKER);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = commentBody.indexOf(CHECKPOINT_SUFFIX, startIndex);
  if (endIndex === -1) {
    return null;
  }

  const jsonStr = commentBody.slice(
    startIndex + CHECKPOINT_MARKER.length,
    endIndex
  );

  try {
    const parsed = JSON.parse(jsonStr);
    
    // Validate required fields
    if (!parsed.sha || typeof parsed.timestamp !== 'number') {
      return null;
    }

    return {
      sha: parsed.sha,
      timestamp: parsed.timestamp,
      filesReviewed: Array.isArray(parsed.filesReviewed) ? parsed.filesReviewed : [],
      commentCount: typeof parsed.commentCount === 'number' ? parsed.commentCount : 0,
      verdict: parsed.verdict || 'comment'
    };
  } catch (error: any) {
    console.warn(`[AgnusAI] Malformed checkpoint JSON, falling back to full review. Snippet: "${jsonStr.slice(0, 80)}..." Error: ${error.message}`);
    return null;
  }
}

/**
 * Serialize a checkpoint to HTML comment format for embedding in a comment body
 * 
 * @param checkpoint The checkpoint to serialize
 * @returns The serialized checkpoint as an HTML comment
 */
export function serializeCheckpoint(checkpoint: ReviewCheckpoint): string {
  const data = {
    sha: checkpoint.sha,
    timestamp: checkpoint.timestamp,
    filesReviewed: checkpoint.filesReviewed,
    commentCount: checkpoint.commentCount,
    verdict: checkpoint.verdict
  };

  return `${CHECKPOINT_MARKER}${JSON.stringify(data)}${CHECKPOINT_SUFFIX}`;
}

/**
 * Create a new checkpoint for the current review state
 * 
 * @param sha The current HEAD SHA of the PR
 * @param filesReviewed List of files that were reviewed
 * @param commentCount Number of comments in the review
 * @param verdict The review verdict
 * @returns A new checkpoint object
 */
export function createCheckpoint(
  sha: string,
  filesReviewed: string[],
  commentCount: number,
  verdict: 'approve' | 'request_changes' | 'comment'
): ReviewCheckpoint {
  return {
    sha,
    timestamp: Math.floor(Date.now() / 1000),
    filesReviewed,
    commentCount,
    verdict
  };
}

/**
 * Find the checkpoint comment among PR comments
 * Returns the NEWEST checkpoint by timestamp (not the first one found)
 * 
 * @param comments List of PR comments to search
 * @param botName Optional bot name to look for (defaults to common patterns)
 * @returns The checkpoint comment and parsed checkpoint, or null if not found
 */
export function findCheckpointComment(
  comments: PRComment[],
  botName?: string
): { comment: PRComment; checkpoint: ReviewCheckpoint } | null {
  // Common bot name patterns to check
  const botPatterns = [
    botName,
    CHECKPOINT_USER_AGENT,
    'agnus-ai',
    'agnus[bot]',
    'github-actions[bot]'
  ].filter(Boolean);

  // Find ALL checkpoints, sort by timestamp, return newest
  const allCheckpoints: Array<{ comment: PRComment; checkpoint: ReviewCheckpoint }> = [];

  for (const comment of comments) {
    // Check if this comment has our checkpoint marker
    const checkpoint = parseCheckpoint(comment.body);
    if (checkpoint) {
      allCheckpoints.push({ comment, checkpoint });
      continue;
    }

    // Also check bot patterns for backwards compatibility
    const isBot = comment.user.type === 'Bot' || 
                  botPatterns.some(pattern => 
                    comment.user.login.toLowerCase().includes(pattern?.toLowerCase() || '')
                  );

    if (!isBot) {
      continue;
    }

    // Try to parse checkpoint from this bot comment
    const checkpoint2 = parseCheckpoint(comment.body);
    if (checkpoint2) {
      allCheckpoints.push({ comment, checkpoint: checkpoint2 });
    }
  }

  // If no checkpoints found, return null
  if (allCheckpoints.length === 0) {
    return null;
  }

  // Sort by timestamp (newest first) and return the newest
  allCheckpoints.sort((a, b) => b.checkpoint.timestamp - a.checkpoint.timestamp);
  return allCheckpoints[0];
}

/**
 * Generate the full comment body for a checkpoint
 * Includes the checkpoint metadata and a human-readable summary
 * 
 * @param checkpoint The checkpoint to embed
 * @param summary Optional human-readable summary
 * @returns The full comment body
 */
export function generateCheckpointComment(
  checkpoint: ReviewCheckpoint,
  summary?: string
): string {
  const checkpointMeta = serializeCheckpoint(checkpoint);
  const dateStr = new Date(checkpoint.timestamp * 1000).toISOString();
  
  const defaultSummary = `## 🔍 AgnusAI Review Checkpoint

**Last reviewed commit:** \`${checkpoint.sha.substring(0, 7)}\`
**Reviewed at:** ${dateStr}
**Files reviewed:** ${checkpoint.filesReviewed.length}
**Comments:** ${checkpoint.commentCount}
**Verdict:** ${checkpoint.verdict === 'approve' ? '✅ Approved' : checkpoint.verdict === 'request_changes' ? '🔄 Changes Requested' : '💬 Commented'}

---
*This checkpoint enables incremental reviews. New commits will only trigger review of new changes.*`;

  return `${checkpointMeta}\n\n${summary || defaultSummary}`;
}

/**
 * Check if a checkpoint is stale (too old to be useful)
 * 
 * @param checkpoint The checkpoint to check
 * @param maxAgeDays Maximum age in days (default: 30)
 * @returns True if the checkpoint is stale
 */
export function isCheckpointStale(
  checkpoint: ReviewCheckpoint,
  maxAgeDays: number = 30
): boolean {
  const ageMs = Date.now() - (checkpoint.timestamp * 1000);
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs > maxAgeMs;
}

/**
 * Validate that a checkpoint SHA exists in the commit history
 * This is useful to detect force pushes that invalidate checkpoints
 * 
 * @param checkpointSha The SHA from the checkpoint
 * @param currentHeadSha The current HEAD SHA
 * @param commitsAhead Number of commits the PR is ahead of base
 * @returns True if the checkpoint appears valid
 */
export function validateCheckpointSha(
  checkpointSha: string,
  currentHeadSha: string,
  commitsAhead: number
): boolean {
  // If SHA is the same as current HEAD, no new commits
  if (checkpointSha === currentHeadSha) {
    return true;
  }

  // If commitsAhead is 0, the checkpoint SHA should match HEAD
  // Otherwise, we need the GitHub compare API to validate
  // This is a basic heuristic - full validation requires API call
  return commitsAhead > 0;
}

export default {
  parseCheckpoint,
  serializeCheckpoint,
  createCheckpoint,
  findCheckpointComment,
  generateCheckpointComment,
  isCheckpointStale,
  validateCheckpointSha,
  CHECKPOINT_MARKER,
  CHECKPOINT_SUFFIX,
  CHECKPOINT_USER_AGENT
};