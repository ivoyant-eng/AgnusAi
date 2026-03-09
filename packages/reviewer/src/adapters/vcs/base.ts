// VCS Adapter Base Interface - Platform Agnostic

import {
  PullRequest,
  Diff,
  FileInfo,
  ReviewComment,
  Review,
  Ticket,
  Author,
  FileDiff,
  CommitComparison,
  PRComment,
  ReviewCheckpoint,
  DetailedReviewComment,
  FileRename,
  PRDescriptionResult
} from '../../types';

/**
 * Platform-agnostic VCS adapter interface
 * Implemented by GitHub, Azure DevOps, and future adapters
 */
export interface VCSAdapter {
  readonly name: string;

  // ============================================
  // PR Operations
  // ============================================
  
  /** Get PR metadata */
  getPR(prId: string | number): Promise<PullRequest>;
  
  /** Get the diff for a PR */
  getDiff(prId: string | number): Promise<Diff>;
  
  /** Get list of changed files with language detection */
  getFiles(prId: string | number): Promise<FileInfo[]>;
  
  /** Get author information */
  getAuthor(prId: string | number): Promise<Author>;
  
  /** Get linked tickets/issues from PR description */
  getLinkedTickets(prId: string | number): Promise<Ticket[]>;

  /**
   * Update PR title and description/body
   */
  updatePRDescription?(prId: string | number, description: PRDescriptionResult): Promise<void>;

  // ============================================
  // Comments - Basic
  // ============================================
  
  /** Add a PR-level comment (not inline) */
  addComment(prId: string | number, comment: ReviewComment): Promise<void>;
  
  /** Add an inline comment on a specific file/line */
  addInlineComment(
    prId: string | number,
    path: string,
    line: number,
    body: string,
    severity?: 'info' | 'warning' | 'error'
  ): Promise<void>;
  
  /** Submit a review with summary and inline comments */
  submitReview(prId: string | number, review: Review): Promise<void>;

  // ============================================
  // Comments - Extended (for deduplication)
  // ============================================
  
  /**
   * Get ALL review comments (inline comments on code)
   * Should handle pagination to get all comments
   * 
   * @param prId PR number
   * @returns List of detailed review comments
   */
  getReviewComments?(prId: string | number): Promise<DetailedReviewComment[]>;
  
  /**
   * Get PR-level comments (not inline)
   * Used for finding checkpoint comments
   * 
   * @param prId PR number
   * @returns List of PR comments
   */
  getPRComments?(prId: string | number): Promise<PRComment[]>;
  
  /**
   * Update an existing review comment
   * 
   * @param prId PR number
   * @param commentId Platform-specific comment ID (number for GitHub, string for Azure)
   * @param body New comment body
   */
  updateReviewComment?(prId: string | number, commentId: string | number, body: string): Promise<void>;
  
  /**
   * Delete a review comment
   * 
   * @param prId PR number
   * @param commentId Platform-specific comment ID
   */
  deleteReviewComment?(prId: string | number, commentId: string | number): Promise<void>;
  
  /**
   * Get a single review comment by ID
   * 
   * @param commentId Platform-specific comment ID
   */
  getReviewComment?(commentId: string | number): Promise<DetailedReviewComment>;

  // ============================================
  // Checkpoint Management
  // ============================================
  
  /**
   * Find existing checkpoint comment
   * 
   * @param prId PR number
   * @returns The checkpoint comment or null
   */
  findCheckpointComment?(prId: string | number): Promise<PRComment | null>;
  
  /**
   * Create a checkpoint comment
   * 
   * @param prId PR number
   * @param checkpoint Checkpoint data
   * @returns The created comment ID
   */
  createCheckpointComment?(prId: string | number, checkpoint: ReviewCheckpoint): Promise<string | number>;
  
  /**
   * Update an existing checkpoint comment
   * 
   * @param commentId Comment ID to update
   * @param checkpoint New checkpoint data
   */
  updateCheckpointComment?(commentId: string | number, checkpoint: ReviewCheckpoint): Promise<void>;
  
  /**
   * Delete a checkpoint comment
   * Used for cleaning up duplicate checkpoints
   * 
   * @param commentId Comment ID to delete
   */
  deleteCheckpointComment?(commentId: string | number): Promise<void>;

  // ============================================
  // File Operations
  // ============================================
  
  /** Get file content at a specific ref */
  getFileContent(path: string, ref?: string): Promise<string>;
  
  /**
   * Get file renames in a PR
   * Used for tracking line movement
   * 
   * @param prId PR number
   * @returns List of file renames
   */
  getFileRenames?(prId: string | number): Promise<FileRename[]>;

  // ============================================
  // Incremental Review
  // ============================================
  
  /**
   * Compare two commits
   * 
   * @param baseSha Base commit SHA
   * @param headSha Head commit SHA
   */
  compareCommits?(baseSha: string, headSha: string): Promise<CommitComparison>;
  
  /**
   * Get HEAD SHA of a PR
   * 
   * @param prId PR number
   */
  getHeadSha?(prId: string | number): Promise<string>;
  
  /**
   * Get incremental diff since checkpoint
   * 
   * @param prId PR number
   * @param checkpointSha Checkpoint commit SHA
   */
  getIncrementalDiff?(prId: string | number, checkpointSha: string): Promise<{
    diff: Diff | null;
    isIncremental: boolean;
    reason?: string;
  }>;

  // ============================================
  // PR State Checks
  // ============================================
  
  /**
   * Check if PR is a draft
   * 
   * @param prId PR number
   */
  isDraft?(prId: string | number): Promise<boolean>;
  
  /**
   * Check if PR is merged
   * 
   * @param prId PR number
   */
  isMerged?(prId: string | number): Promise<boolean>;
  
  /**
   * Check if PR is closed
   * 
   * @param prId PR number
   */
  isClosed?(prId: string | number): Promise<boolean>;
  
  /**
   * Check if discussion is locked
   * 
   * @param prId PR number
   */
  isLocked?(prId: string | number): Promise<boolean>;

  // ============================================
  // Rate Limiting
  // ============================================
  
  /**
   * Get current rate limit status
   * 
   * @returns Rate limit info or null if not applicable
   */
  getRateLimit?(): Promise<{
    limit: number;
    remaining: number;
    resetAt: Date;
  } | null>;

  // ============================================
  // Reply/Thread Handling
  // ============================================
  
  /**
   * Create a reply to an existing review comment
   * 
   * @param prId PR number
   * @param commentId Parent comment ID
   * @param body Reply body
   */
  createReply?(prId: string | number, commentId: string | number, body: string): Promise<void>;
}

/**
 * Check if a VCS adapter supports all deduplication features
 */
export function hasDeduplicationSupport(adapter: VCSAdapter): boolean {
  return !!(
    adapter.getReviewComments &&
    adapter.getPRComments &&
    adapter.updateReviewComment &&
    adapter.deleteReviewComment
  );
}

/**
 * Check if a VCS adapter supports checkpoints
 */
export function hasCheckpointSupport(adapter: VCSAdapter): boolean {
  return !!(
    adapter.findCheckpointComment &&
    adapter.createCheckpointComment &&
    adapter.updateCheckpointComment
  );
}

/**
 * Check if a VCS adapter supports incremental reviews
 */
export function hasIncrementalSupport(adapter: VCSAdapter): boolean {
  return !!(
    adapter.compareCommits &&
    adapter.getHeadSha &&
    adapter.getIncrementalDiff
  );
}
