// Comment Manager - Platform-Agnostic Comment Deduplication
// Works with any VCS adapter (GitHub, Azure DevOps, etc.)

import { VCSAdapter, hasDeduplicationSupport, hasCheckpointSupport } from '../adapters/vcs/base';
import {
  ReviewComment,
  Review,
  PullRequest,
  Diff,
  DetailedReviewComment,
  ReviewCheckpoint,
  PRComment,
  PRState,
  FileRename
} from '../types';
import {
  filterComments,
  sortCommentsByPriority,
  consolidateComments,
  checkPRState,
  generateIdempotencyKey,
  generateIssueId,
  generateCommentMetadata,
  parseCommentMetadata,
  isAgnusaiComment,
  shouldSkipFile,
  DEFAULT_DEDUP_CONFIG,
  DeduplicationConfig,
  FilterReason,
  FilteredComments,
  rateLimitTracker
} from './deduplication';
import { AGNUSAI_MARKER } from './thread';

/**
 * Result of managing comments
 */
export interface CommentManagerResult {
  posted: number;
  filtered: Array<{ comment: ReviewComment; reason: FilterReason }>;
  skipped: string[];
  skippedFiles: string[];
  warnings: string[];
  errors: string[];
  checkpoint?: {
    created: boolean;
    updated: boolean;
    commentId?: string | number;
  };
}

/**
 * Options for the comment manager
 */
export interface CommentManagerOptions {
  vcs: VCSAdapter;
  config?: Partial<DeduplicationConfig>;
  commitSha: string;
  enableCheckpoint?: boolean;
  enableIncremental?: boolean;
}

/**
 * Platform-agnostic comment manager
 * Handles deduplication, filtering, and posting comments
 */
export class CommentManager {
  private vcs: VCSAdapter;
  private config: DeduplicationConfig;
  private commitSha: string;
  private enableCheckpoint: boolean;
  private enableIncremental: boolean;
  
  // Idempotency tracking (in-memory, for concurrent request handling)
  private static pendingOperations = new Map<string, { timestamp: number; status: 'pending' | 'completed' | 'failed' }>();
  private static readonly IDEMPOTENCY_TTL_MS = 60000; // 1 minute
  
  constructor(options: CommentManagerOptions) {
    this.vcs = options.vcs;
    this.config = { ...DEFAULT_DEDUP_CONFIG, ...options.config };
    this.commitSha = options.commitSha;
    this.enableCheckpoint = options.enableCheckpoint ?? true;
    this.enableIncremental = options.enableIncremental ?? true;
  }
  
  /**
   * Main entry point: Process and post comments
   */
  async processComments(
    prId: string | number,
    comments: ReviewComment[],
    summary: string,
    verdict: Review['verdict']
  ): Promise<CommentManagerResult> {
    const result: CommentManagerResult = {
      posted: 0,
      filtered: [],
      skipped: [],
      skippedFiles: [],
      warnings: [],
      errors: []
    };
    
    try {
      // Step 1: Check PR state
      const pr = await this.vcs.getPR(prId);
      const stateResult = await this.checkPRState(prId, pr);
      
      if (!stateResult.canProceed) {
        result.warnings.push(stateResult.reason!);
        return result;
      }
      
      // Step 2: Check rate limits
      const rateLimitResult = await this.checkRateLimit();
      if (!rateLimitResult.allowed) {
        result.warnings.push(`Rate limited. Reset in ${Math.ceil((rateLimitResult.resetIn || 0) / 1000)}s`);
        return result;
      }
      
      // Step 3: Get existing comments for deduplication
      const existingComments = await this.getExistingComments(prId);
      result.warnings.push(...existingComments.warnings);
      
      // Step 4: Get diff for line validation
      const diff = await this.vcs.getDiff(prId);
      
      // Step 5: Filter comments
      const filterResult = filterComments(
        comments,
        existingComments.comments,
        diff,
        pr,
        this.config
      );
      
      result.filtered = filterResult.filtered;
      result.skippedFiles = filterResult.skippedFiles;
      result.warnings.push(...filterResult.warnings);
      
      // Step 6: Sort by priority
      const sortedComments = sortCommentsByPriority(filterResult.comments);
      
      // Step 7: Add metadata to comments
      const commentsWithMeta = sortedComments.map(c => this.addMetadata(c));
      
      // Step 8: Post comments with error recovery
      const postResult = await this.postCommentsWithRecovery(prId, commentsWithMeta);
      result.posted = postResult.posted;
      result.errors.push(...postResult.errors);
      
      // Step 9: Handle checkpoint
      if (this.enableCheckpoint && hasCheckpointSupport(this.vcs)) {
        const checkpointResult = await this.handleCheckpoint(prId, result.posted, verdict);
        result.checkpoint = checkpointResult;
      }
      
      return result;
    } catch (error: any) {
      result.errors.push(`Fatal error: ${error.message}`);
      
      // Attempt partial recovery - try to post summary at least
      try {
        await this.vcs.addComment(prId, {
          path: '',
          line: 0,
          body: `${verdict === 'approve' ? '✅' : verdict === 'request_changes' ? '🔄' : '💬'} **Review Summary**\n\n${summary}\n\n*Note: Some inline comments may not have been posted due to errors.*`,
          severity: 'info'
        });
      } catch {
        result.errors.push('Failed to post summary comment');
      }
      
      return result;
    }
  }
  
  /**
   * Check if PR is in a reviewable state
   */
  private async checkPRState(
    prId: string | number,
    pr: PullRequest
  ): Promise<{ canProceed: boolean; reason?: string }> {
    // Check using adapter methods if available
    if (this.vcs.isDraft && await this.vcs.isDraft(prId)) {
      return { canProceed: false, reason: 'PR is a draft' };
    }
    
    if (this.vcs.isMerged && await this.vcs.isMerged(prId)) {
      return { canProceed: false, reason: 'PR is already merged' };
    }
    
    if (this.vcs.isClosed && await this.vcs.isClosed(prId)) {
      return { canProceed: false, reason: 'PR is closed' };
    }
    
    if (this.vcs.isLocked && await this.vcs.isLocked(prId)) {
      return { canProceed: false, reason: 'Discussion is locked' };
    }
    
    // Fallback to checking PR object
    const stateResult = checkPRState(pr);
    if (!stateResult.canReview) {
      return { canProceed: false, reason: stateResult.reason };
    }
    
    return { canProceed: true };
  }
  
  /**
   * Check rate limits
   */
  private async checkRateLimit(): Promise<{ allowed: boolean; resetIn?: number }> {
    // Check adapter-specific rate limit if available
    if (this.vcs.getRateLimit) {
      const limit = await this.vcs.getRateLimit();
      if (limit && limit.remaining < 10) {
        return { allowed: false, resetIn: limit.resetAt.getTime() - Date.now() };
      }
    }
    
    // Check internal rate limit tracker
    const internalLimit = rateLimitTracker.checkLimit();
    if (!internalLimit.allowed) {
      return { allowed: false, resetIn: internalLimit.resetIn };
    }
    
    return { allowed: true };
  }
  
  /**
   * Get existing comments from PR
   */
  private async getExistingComments(
    prId: string | number
  ): Promise<{ comments: DetailedReviewComment[]; warnings: string[] }> {
    const comments: DetailedReviewComment[] = [];
    const warnings: string[] = [];
    
    if (!hasDeduplicationSupport(this.vcs)) {
      warnings.push('VCS adapter does not support deduplication - skipping duplicate check');
      return { comments, warnings };
    }
    
    try {
      const reviewComments = await this.vcs.getReviewComments!(prId);
      comments.push(...reviewComments);
    } catch (error: any) {
      warnings.push(`Failed to fetch existing review comments: ${error.message}`);
    }
    
    return { comments, warnings };
  }
  
  /**
   * Add metadata to a comment
   */
  private addMetadata(comment: ReviewComment): ReviewComment {
    const issueId = generateIssueId(comment);
    const metaStr = generateCommentMetadata(this.commitSha, issueId);
    
    // Append marker and metadata
    const body = comment.body.trim();
    const markedBody = body.endsWith(AGNUSAI_MARKER) ? body : `${body}\n\n${AGNUSAI_MARKER}`;
    const bodyWithMeta = `${markedBody}\n\n${metaStr}`;
    
    // Check length limit (GitHub: 65536 chars)
    const maxLength = 65000;
    const finalBody = bodyWithMeta.length > maxLength 
      ? bodyWithMeta.slice(0, maxLength - 50) + '\n\n*[truncated]*\n\n' + AGNUSAI_MARKER
      : bodyWithMeta;
    
    return { ...comment, body: finalBody };
  }
  
  /**
   * Post comments with error recovery
   */
  private async postCommentsWithRecovery(
    prId: string | number,
    comments: ReviewComment[]
  ): Promise<{ posted: number; errors: string[] }> {
    const errors: string[] = [];
    let posted = 0;
    
    for (const comment of comments) {
      // Check idempotency
      const idempotencyKey = generateIdempotencyKey(
        this.commitSha,
        comment.path,
        comment.line,
        generateIssueId(comment)
      );
      
      if (await this.isOperationPending(idempotencyKey)) {
        errors.push(`Skipping comment at ${comment.path}:${comment.line} - operation already in progress`);
        continue;
      }
      
      // Mark as pending
      this.markOperationPending(idempotencyKey);
      
      try {
        await this.vcs.addInlineComment(
          prId,
          comment.path,
          comment.line,
          comment.body,
          comment.severity
        );
        
        posted++;
        rateLimitTracker.recordRequest();
        this.markOperationCompleted(idempotencyKey);
        
        // Small delay to avoid rate limiting
        await this.delay(100);
      } catch (error: any) {
        this.markOperationFailed(idempotencyKey);
        errors.push(`Failed to post comment at ${comment.path}:${comment.line}: ${error.message}`);
        
        // Continue with other comments
        continue;
      }
    }
    
    return { posted, errors };
  }
  
  /**
   * Handle checkpoint creation/update
   * Merges filesReviewed from previous checkpoint and deletes duplicates
   */
  private async handleCheckpoint(
    prId: string | number,
    commentCount: number,
    verdict: Review['verdict']
  ): Promise<{ created: boolean; updated: boolean; commentId?: string | number }> {
    if (!hasCheckpointSupport(this.vcs)) {
      return { created: false, updated: false };
    }
    
    try {
      // Find existing checkpoint
      const existing = await this.vcs.findCheckpointComment!(prId);
      
      // Get files reviewed from current diff
      const diff = await this.vcs.getDiff(prId);
      const currentFiles = diff.files.map(f => f.path);
      
      // Merge with previous filesReviewed if exists
      let allFilesReviewed = currentFiles;
      if (existing) {
        // Parse the checkpoint from the existing comment
        const prevCheckpoint = this.parseCheckpointFromComment(existing.body);
        if (prevCheckpoint?.filesReviewed) {
          allFilesReviewed = [...new Set([...prevCheckpoint.filesReviewed, ...currentFiles])];
        }
      }
      
      const checkpoint: ReviewCheckpoint = {
        sha: this.commitSha,
        timestamp: Math.floor(Date.now() / 1000),
        filesReviewed: allFilesReviewed,
        commentCount,
        verdict
      };
      
      if (existing) {
        // Update existing checkpoint
        await this.vcs.updateCheckpointComment!(existing.id, checkpoint);
        
        // Delete any other checkpoint comments (duplicates)
        if (this.vcs.getPRComments && this.vcs.deleteCheckpointComment) {
          const allComments = await this.vcs.getPRComments(prId);
          const duplicates = allComments.filter(c => 
            c.body.includes('AGNUSAI_CHECKPOINT') && c.id !== existing.id
          );
          
          for (const dup of duplicates) {
            console.log(`🗑️  Deleting duplicate checkpoint comment ${dup.id}`);
            try {
              await this.vcs.deleteCheckpointComment(dup.id);
            } catch (error: any) {
              console.warn(`Failed to delete duplicate checkpoint: ${error.message}`);
            }
          }
        }
        
        return { created: false, updated: true, commentId: existing.id };
      } else {
        // Create new checkpoint
        const commentId = await this.vcs.createCheckpointComment!(prId, checkpoint);
        return { created: true, updated: false, commentId };
      }
    } catch (error: any) {
      console.error('Failed to manage checkpoint:', error);
      return { created: false, updated: false };
    }
  }
  
  /**
   * Parse checkpoint from comment body
   */
  private parseCheckpointFromComment(body: string): ReviewCheckpoint | null {
    const marker = '<!-- AGNUSAI_CHECKPOINT:';
    const suffix = ' -->';
    const startIndex = body.indexOf(marker);
    if (startIndex === -1) return null;
    
    const endIndex = body.indexOf(suffix, startIndex);
    if (endIndex === -1) return null;
    
    const jsonStr = body.slice(startIndex + marker.length, endIndex);
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.sha || typeof parsed.timestamp !== 'number') return null;
      return {
        sha: parsed.sha,
        timestamp: parsed.timestamp,
        filesReviewed: Array.isArray(parsed.filesReviewed) ? parsed.filesReviewed : [],
        commentCount: typeof parsed.commentCount === 'number' ? parsed.commentCount : 0,
        verdict: parsed.verdict || 'comment'
      };
    } catch {
      return null;
    }
  }
  
  // ============================================
  // Idempotency helpers
  // ============================================
  
  private async isOperationPending(key: string): Promise<boolean> {
    const op = CommentManager.pendingOperations.get(key);
    if (!op) return false;
    
    // Check if TTL expired
    if (Date.now() - op.timestamp > CommentManager.IDEMPOTENCY_TTL_MS) {
      CommentManager.pendingOperations.delete(key);
      return false;
    }
    
    return op.status === 'pending';
  }
  
  private markOperationPending(key: string): void {
    CommentManager.pendingOperations.set(key, {
      timestamp: Date.now(),
      status: 'pending'
    });
    
    // Cleanup old entries periodically
    this.cleanupPendingOperations();
  }
  
  private markOperationCompleted(key: string): void {
    CommentManager.pendingOperations.set(key, {
      timestamp: Date.now(),
      status: 'completed'
    });
  }
  
  private markOperationFailed(key: string): void {
    CommentManager.pendingOperations.set(key, {
      timestamp: Date.now(),
      status: 'failed'
    });
  }
  
  private cleanupPendingOperations(): void {
    const now = Date.now();
    for (const [key, op] of CommentManager.pendingOperations) {
      if (now - op.timestamp > CommentManager.IDEMPOTENCY_TTL_MS) {
        CommentManager.pendingOperations.delete(key);
      }
    }
  }
  
  // ============================================
  // Utility helpers
  // ============================================
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create a comment manager
 */
export function createCommentManager(options: CommentManagerOptions): CommentManager {
  return new CommentManager(options);
}