// PR Review Agent - Main Entry Point

export { GitHubAdapter, createGitHubAdapter } from './adapters/vcs/github';
export { AzureDevOpsAdapter, createAzureDevOpsAdapter } from './adapters/vcs/azure-devops';
export { VCSAdapter } from './adapters/vcs/base';

export { JiraAdapter } from './adapters/ticket/jira';
export { LinearAdapter } from './adapters/ticket/linear';
export { TicketAdapter } from './adapters/ticket/base';

export { OllamaBackend, createOllamaBackend } from './llm/ollama';
export { ClaudeBackend, createClaudeBackend } from './llm/claude';
export { OpenAIBackend, createOpenAIBackend } from './llm/openai';
export { UnifiedLLMBackend, UnifiedLLMConfig, ProviderName, PROVIDER_PRESETS } from './llm/unified';
export { LLMBackend } from './llm/base';

export { SkillLoader } from './skills/loader';

// Export checkpoint functions
export {
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
} from './review/checkpoint';

export * from './types';
export { filterByConfidence, DEFAULT_PRECISION_CONFIG } from './review/precision-filter';
export type { PrecisionFilterConfig, FilteredByConfidence } from './review/precision-filter';

import { VCSAdapter } from './adapters/vcs/base';
import { TicketAdapter } from './adapters/ticket/base';
import { LLMBackend } from './llm/base';
import { SkillLoader } from './skills/loader';
import { ReviewContext, ReviewResult, ReviewComment, Diff, Config, ReviewCheckpoint, IncrementalReviewOptions } from './types';
import type { GraphReviewContext } from '@agnus-ai/shared';
import { GitHubAdapter } from './adapters/vcs/github';
import {
  findCheckpointComment,
  createCheckpoint,
  generateCheckpointComment,
} from './review/checkpoint';
import { filterByConfidence } from './review/precision-filter';

/**
 * Result of an incremental review check
 */
export interface IncrementalCheckResult {
  /** Whether this is an incremental review */
  isIncremental: boolean;
  /** Reason if not incremental */
  reason?: string;
  /** The checkpoint if found */
  checkpoint?: ReviewCheckpoint;
  /** The comment ID if checkpoint found */
  checkpointCommentId?: number;
}

/**
 * Extended review result that tracks all files reviewed (not just files with comments)
 */
export interface ExtendedReviewResult extends ReviewResult {
  /** All files that were in the diff and reviewed */
  filesReviewed?: string[];
}

export class PRReviewAgent {
  private vcs: VCSAdapter;
  private tickets: TicketAdapter[];
  private llm: LLMBackend;
  private skills: SkillLoader;
  private config: Config;
  private lastDiff: Diff | null = null;
  private checkpointHandled: boolean = false;

  constructor(config: Config) {
    this.config = config;
    // These will be initialized by factory methods
    this.vcs = null as any;
    this.tickets = [];
    this.llm = null as any;
    this.skills = new SkillLoader(config.skills.path);
  }

  setVCS(adapter: VCSAdapter): void {
    this.vcs = adapter;
  }

  setLLM(backend: LLMBackend): void {
    this.llm = backend;
  }

  addTicketAdapter(adapter: TicketAdapter): void {
    this.tickets.push(adapter);
  }

  /**
   * Check if an incremental review is possible
   */
  async checkIncremental(prId: string | number): Promise<IncrementalCheckResult> {
    // Only GitHub adapter supports incremental reviews
    if (!(this.vcs instanceof GitHubAdapter)) {
      return { isIncremental: false, reason: 'Incremental reviews only supported for GitHub' };
    }

    const github = this.vcs as GitHubAdapter;

    // Get all issue comments on the PR
    const comments = await github.getPRComments(prId);

    // Find checkpoint comment
    const found = findCheckpointComment(comments);

    if (!found) {
      return { isIncremental: false, reason: 'No checkpoint comment found' };
    }

    return {
      isIncremental: true,
      checkpoint: found.checkpoint,
      checkpointCommentId: found.comment.id
    };
  }

  /**
   * Perform an incremental review (only review new commits)
   */
  async incrementalReview(
    prId: string | number,
    options: IncrementalReviewOptions = {},
    graphContext?: GraphReviewContext
  ): Promise<ReviewResult> {
    // Reset checkpoint flag for new review
    this.checkpointHandled = false;

    // Check for checkpoint
    const checkResult = await this.checkIncremental(prId);

    if (options.forceFull || !checkResult.isIncremental || !checkResult.checkpoint) {
      console.log(`📋 Full review mode: ${checkResult.reason || 'forced'}`);
      return this.review(prId, graphContext);
    }

    const github = this.vcs as GitHubAdapter;
    const checkpoint = checkResult.checkpoint;

    console.log(`🔄 Incremental review from checkpoint: ${checkpoint.sha.substring(0, 7)}`);
    console.log(`📁 Previously reviewed files (${checkpoint.filesReviewed.length}): ${checkpoint.filesReviewed.join(', ')}`);

    // Get incremental diff
    const incrementalResult = await github.getIncrementalDiff(prId, checkpoint.sha);

    if (!incrementalResult.isIncremental) {
      console.log(`⚠️  Cannot do incremental review: ${incrementalResult.reason}`);
      return this.review(prId);
    }

    // If no changes, return empty result
    if (incrementalResult.diff.files.length === 0) {
      console.log('📋 No new changes since last checkpoint');
      return {
        summary: 'No new changes since last review checkpoint.',
        comments: [],
        suggestions: [],
        verdict: 'comment'
      };
    }

    console.log(`📁 Incremental review: ${incrementalResult.diff.files.length} changed files:`);
    for (const file of incrementalResult.diff.files) {
      console.log(`   - ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`);
    }

    // Fetch PR data
    const pr = await this.vcs.getPR(prId);
    const files = await this.vcs.getFiles(prId);

    // Filter files to only those changed since checkpoint
    const changedFilePaths = new Set(incrementalResult.diff.files.map(f => f.path));
    const relevantFiles = files.filter(f => changedFilePaths.has(f.path));

    // Get linked tickets
    const linkedTicketIds = await this.vcs.getLinkedTickets(prId);
    const tickets = [];
    for (const adapter of this.tickets) {
      for (const id of linkedTicketIds) {
        try {
          const ticket = await adapter.getTicket(id.key);
          tickets.push(ticket);
        } catch {
          // Ticket not found
        }
      }
    }

    // Load applicable skills
    const applicableSkills = await this.skills.matchSkills(
      relevantFiles.map(f => f.path)
    );

    // Build context with incremental diff
    const context: ReviewContext = {
      pr,
      diff: incrementalResult.diff,
      files: relevantFiles,
      tickets,
      skills: applicableSkills,
      config: this.config.review,
      graphContext,
    };

    // Run review
    const result = await this.llm.generateReview(context);

    // Precision filter
    const threshold = this.config.review?.precisionThreshold ?? 0.7;
    const { kept, filtered } = filterByConfidence(result.comments, { minConfidence: threshold });
    if (filtered.length > 0) {
      console.log(`🎯 Precision filter: ${kept.length}/${result.comments.length} comments kept (threshold ${threshold})`);
    }
    result.comments = kept.length > 0 ? kept : result.comments.filter(c => c.confidence === undefined);

    // Add checkpoint marker to summary
    result.summary = `[Incremental Review: ${incrementalResult.diff.files.length} new files]\n\n${result.summary}`;

    // Track all files that were reviewed (not just files with comments)
    const filesInDiff = incrementalResult.diff.files.map(f => f.path);
    (result as ExtendedReviewResult).filesReviewed = filesInDiff;

    // Cache diff
    this.lastDiff = incrementalResult.diff;

    // Update checkpoint if not skipped
    if (!options.skipCheckpoint && checkResult.checkpointCommentId) {
      await this.updateCheckpoint(prId, result, checkResult.checkpointCommentId, checkpoint);
      this.checkpointHandled = true;
    }

    return result;
  }

  /**
   * Create or update checkpoint after review
   * Merges filesReviewed from previous checkpoint to track all reviewed files
   */
  private async updateCheckpoint(
    prId: string | number,
    result: ReviewResult,
    existingCommentId?: number,
    previousCheckpoint?: ReviewCheckpoint
  ): Promise<void> {
    const github = this.vcs as GitHubAdapter;
    const headSha = await github.getHeadSha(prId);

    // Get files reviewed - use extended result if available, otherwise fall back to comment files
    const extendedResult = result as ExtendedReviewResult;
    const currentReviewedFiles = extendedResult.filesReviewed || result.comments.map(c => c.path);

    // Merge files: start with previously reviewed files, add current ones, deduplicate
    const previousFiles = previousCheckpoint?.filesReviewed || [];
    const allFilesReviewed = [...new Set([...previousFiles, ...currentReviewedFiles])];

    console.log(`📁 Checkpoint files: ${previousFiles.length} previous + ${currentReviewedFiles.length} current = ${allFilesReviewed.length} total`);

    const checkpoint = createCheckpoint(
      headSha,
      allFilesReviewed,
      result.comments.length,
      result.verdict
    );

    if (existingCommentId) {
      console.log('📝 Updating checkpoint comment...');
      await github.updateCheckpointComment(existingCommentId, checkpoint);
    } else {
      console.log('📝 Creating checkpoint comment...');
      await github.createCheckpointComment(prId, checkpoint);
    }
  }

  async review(prId: string | number, graphContext?: GraphReviewContext): Promise<ReviewResult> {
    // Reset checkpoint flag for new review
    this.checkpointHandled = false;

    // 1. Fetch PR data
    const pr = await this.vcs.getPR(prId);
    const diff = await this.vcs.getDiff(prId);
    const files = await this.vcs.getFiles(prId);

    // 2. Get linked tickets
    const linkedTicketIds = await this.vcs.getLinkedTickets(prId);
    const tickets = [];
    for (const adapter of this.tickets) {
      for (const id of linkedTicketIds) {
        try {
          const ticket = await adapter.getTicket(id.key);
          tickets.push(ticket);
        } catch {
          // Ticket not found in this adapter
        }
      }
    }

    // 3. Load applicable skills
    const applicableSkills = await this.skills.matchSkills(
      files.map(f => f.path)
    );

    // 4. Build context
    const context: ReviewContext = {
      pr,
      diff,
      files,
      tickets,
      skills: applicableSkills,
      config: this.config.review,
      graphContext,
    };

    // 5. Run review
    const result = await this.llm.generateReview(context);

    // 6. Precision filter — drop low-confidence comments
    const threshold = this.config.review?.precisionThreshold ?? 0.7;
    const { kept, filtered } = filterByConfidence(result.comments, { minConfidence: threshold });
    if (filtered.length > 0) {
      console.log(`🎯 Precision filter: ${kept.length}/${result.comments.length} comments kept (threshold ${threshold})`);
    }
    result.comments = kept.length > 0 ? kept : result.comments.filter(c => c.confidence === undefined);

    // Cache diff for use in postReview path validation
    this.lastDiff = diff;

    return result;
  }

  async postReview(prId: string | number, result: ReviewResult): Promise<void> {
    const { summary, verdict } = result;

    // Build a set of canonical diff paths (normalised: no leading slash) for matching
    const diff = this.lastDiff ?? await this.vcs.getDiff(prId);
    const diffPathMap = new Map<string, string>(); // normalised → original
    for (const f of diff.files) {
      diffPathMap.set(f.path.replace(/^\//, ''), f.path);
    }

    // Resolve each comment's path against actual diff paths
    const validComments: ReviewComment[] = [];
    for (const comment of result.comments) {
      const normalised = comment.path.replace(/^\//, '');
      const resolvedPath = diffPathMap.get(normalised);
      if (!resolvedPath) {
        console.warn(`⚠️  Skipping comment — path not in diff: ${comment.path}`);
        continue;
      }
      validComments.push({ ...comment, path: resolvedPath });
    }

    // Submit overall review — body is the model-generated markdown, used as-is
    await this.vcs.submitReview(prId, {
      summary,
      comments: validComments,
      verdict
    });

    // Create checkpoint after successful review (only if not already handled by incrementalReview)
    if (!this.checkpointHandled && this.vcs instanceof GitHubAdapter) {
      await this.createCheckpointAfterReview(prId, result);
    }
  }

  /**
   * Create checkpoint comment after review
   * If checkpoint already exists, update it instead of creating a new one
   * Also deletes any duplicate checkpoint comments
   */
  private async createCheckpointAfterReview(prId: string | number, result: ReviewResult): Promise<void> {
    const github = this.vcs as GitHubAdapter;
    const headSha = await github.getHeadSha(prId);

    // Check for existing checkpoint
    const comments = await github.getPRComments(prId);
    const found = findCheckpointComment(comments);

    // Get files reviewed - use extended result if available, otherwise use diff files or fall back to comment files
    const extendedResult = result as ExtendedReviewResult;
    let currentReviewedFiles: string[];

    if (extendedResult.filesReviewed) {
      // Already has files tracked (from incremental review)
      currentReviewedFiles = extendedResult.filesReviewed;
    } else if (this.lastDiff) {
      // For full reviews, use all files in the diff
      currentReviewedFiles = this.lastDiff.files.map(f => f.path);
    } else {
      // Fallback to files with comments
      currentReviewedFiles = result.comments.map(c => c.path);
    }

    // Merge filesReviewed if there was a previous checkpoint
    const previousFiles = found?.checkpoint.filesReviewed || [];
    const allFilesReviewed = [...new Set([...previousFiles, ...currentReviewedFiles])];

    console.log(`📁 Checkpoint files: ${previousFiles.length} previous + ${currentReviewedFiles.length} current = ${allFilesReviewed.length} total`);

    const checkpoint = createCheckpoint(
      headSha,
      allFilesReviewed,
      result.comments.length,
      result.verdict
    );

    if (found) {
      // Update existing checkpoint
      console.log('📝 Updating existing checkpoint comment...');
      await github.updateCheckpointComment(found.comment.id, checkpoint);

      // Delete any other duplicate checkpoint comments
      const allCheckpointComments = comments.filter(c =>
        c.body.includes('AGNUSAI_CHECKPOINT') && c.id !== found.comment.id
      );

      for (const duplicate of allCheckpointComments) {
        console.log(`🗑️  Deleting duplicate checkpoint comment ${duplicate.id}`);
        try {
          await github.deleteCheckpointComment(duplicate.id);
        } catch (error: any) {
          console.warn(`Failed to delete duplicate checkpoint: ${error.message}`);
        }
      }
    } else {
      // Create new checkpoint
      console.log('📝 Creating checkpoint comment...');
      await github.createCheckpointComment(prId, checkpoint);
    }
  }
}