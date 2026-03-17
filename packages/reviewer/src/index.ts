// PR Review Agent - Main Entry Point

export { GitHubAdapter, createGitHubAdapter } from './adapters/vcs/github';
export { AzureDevOpsAdapter, createAzureDevOpsAdapter } from './adapters/vcs/azure-devops';
export { VCSAdapter } from './adapters/vcs/base';

export { JiraAdapter } from './adapters/ticket/jira';
export { LinearAdapter } from './adapters/ticket/linear';
export { AzureBoardsAdapter } from './adapters/ticket/azure-boards';
export { GitHubIssuesAdapter } from './adapters/ticket/github-issues';
export { TicketAdapter } from './adapters/ticket/base';

export { OllamaBackend, createOllamaBackend } from './llm/ollama';
export { ClaudeBackend, createClaudeBackend } from './llm/claude';
export { OpenAIBackend, createOpenAIBackend } from './llm/openai';
export { UnifiedLLMBackend, UnifiedLLMConfig, ProviderName, createBackendFromEnv } from './llm/unified';
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
export { runReviewWithSpecialists } from './review/multi-agent';
export { buildReviewPrompt, buildAskPrompt, buildPRDescriptionPrompt, serializeGraphContext, serializeMermaidGraph } from './llm/prompt';
export { validateSuggestions } from './review/suggestion-validator';
export { runSelfReflection } from './review/self-reflection';
export { detectSplit } from './review/split-detector';
export { loadBestPractices } from './review/best-practices-loader';
export { dispatchCommand, COMMAND_REGISTRY } from './commands';
export type { CommandContext, CommandIntent, CommandResult, CommandDescriptor } from './commands/types';
export { ToolCallCache, SymbolExplorer, fetchLibraryDocs } from './tools';
export type { SymbolGraph, ToolStats } from './tools';
export { detectLibrariesInDiff } from './review/library-detector';

import { VCSAdapter } from './adapters/vcs/base';
import { TicketAdapter } from './adapters/ticket/base';
import { LLMBackend } from './llm/base';
import { SkillLoader } from './skills/loader';
import { ReviewContext, ReviewResult, ReviewComment, Diff, Config, ReviewCheckpoint, IncrementalReviewOptions } from './types';
import type { GraphReviewContext } from '@agnus-ai/shared';
import type { SymbolExplorer } from './tools/SymbolExplorer';
import { GitHubAdapter } from './adapters/vcs/github';
import {
  findCheckpointComment,
  createCheckpoint,
  generateCheckpointComment,
} from './review/checkpoint';
import { filterByConfidence } from './review/precision-filter';
import { runReviewWithSpecialists } from './review/multi-agent';
import { validateSuggestions, type ParseFn } from './review/suggestion-validator';
import { runSelfReflection } from './review/self-reflection';
import { consolidateFindings } from './review/consolidate';
import { detectSplit, formatSplitSuggestion } from './review/split-detector';
import { loadBestPractices } from './review/best-practices-loader';
import { shouldSkipFile, serializeMermaidGraph } from './llm/prompt';

/**
 * Aggregate PR quality score 0–100.
 * 100 = clean PR with no findings; lower = more or higher-severity issues found.
 * Penalty = confidence × severityWeight per comment; normalised so 20 penalty points → score of 0.
 */
export function computePRScore(comments: ReviewComment[]): number {
  if (comments.length === 0) return 100;
  const weights: Record<string, number> = { error: 3, warning: 2, info: 1 };
  const totalPenalty = comments.reduce((sum, c) => {
    const confidence = c.confidence ?? 0.7;
    const weight = weights[c.severity ?? 'info'] ?? 1;
    return sum + confidence * weight;
  }, 0);
  return Math.max(0, Math.min(100, Math.round(100 - totalPenalty * 5)));
}

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

/** Try to get the strict syntax validator from @agnus-ai/core; fall back to passthrough. */
async function getSyntaxParser(): Promise<ParseFn> {
  try {
    const core = await import('@agnus-ai/core' as any);
    if (typeof core.isSyntaxValidStrict === 'function') {
      return core.isSyntaxValidStrict as ParseFn;
    }
  } catch {
    // core not available in this environment — graceful degradation
  }
  return async () => true;
}

export class PRReviewAgent {
  private vcs: VCSAdapter;
  private tickets: TicketAdapter[];
  private llm: LLMBackend;
  private skills: SkillLoader;
  private config: Config;
  private lastDiff: Diff | null = null;
  private lastGraphContext: GraphReviewContext | null = null;
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
    graphContext?: GraphReviewContext,
    symbolExplorer?: SymbolExplorer,
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

    // Get linked tickets (opt-in — ticket integration is behind a feature flag)
    const tickets = [];
    if (this.config.review?.ticketFetchEnabled) {
      const linkedTicketIds = await this.vcs.getLinkedTickets(prId);
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
      symbolExplorer,
    };

    // Run review (single-agent or specialist orchestration)
    const result =
      (await runReviewWithSpecialists(this.llm, context)) ??
      (await this.llm.generateReview(context));

    // Self-reflection second pass (single-agent path only)
    const selfReflectionEnabled = this.config.review?.selfReflectionEnabled;
    const isMultiAgent = Array.isArray((result as any).agentTelemetry) && (result as any).agentTelemetry.length > 0;
    if (selfReflectionEnabled && !isMultiAgent) {
      const reflThreshold = this.config.review?.selfReflectionThreshold ?? 5;
      result.comments = await runSelfReflection(this.llm, context, result.comments, reflThreshold);
    }

    // Inline suggestion validation
    if (result.comments.some(c => c.suggestion)) {
      const parseFn = await getSyntaxParser();
      result.comments = await validateSuggestions(result.comments, relevantFiles, parseFn);
    }

    // Precision filter
    const threshold = this.config.review?.precisionThreshold ?? 0.7;
    const { kept, filtered } = filterByConfidence(result.comments, { minConfidence: threshold });
    if (filtered.length > 0) {
      console.log(`🎯 Precision filter: ${kept.length}/${result.comments.length} comments kept (threshold ${threshold})`);
    }
    result.comments = kept.length > 0 ? kept : result.comments.filter(c => c.confidence === undefined);

    // Deterministic consolidation — region dedup + severity budget
    result.comments = consolidateFindings(result.comments);

    // Attach aggregate PR quality score
    result.prScore = computePRScore(result.comments);

    // Cache graph context for PR description generation
    this.lastGraphContext = graphContext ?? null;

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

  async review(prId: string | number, graphContext?: GraphReviewContext, symbolExplorer?: SymbolExplorer, libraryDocs?: Map<string, string>): Promise<ReviewResult> {
    // Reset checkpoint flag for new review
    this.checkpointHandled = false;

    // 1. Fetch PR data
    const pr = await this.vcs.getPR(prId);
    const diff = await this.vcs.getDiff(prId);
    const files = await this.vcs.getFiles(prId);

    // 1b. Short-circuit: if every changed file is a lock/generated file or a
    //     package manifest with only version-bump changes, skip the LLM entirely.
    const MANIFEST_PATTERN = /^(package\.json|Cargo\.toml|pyproject\.toml|requirements.*\.txt|go\.mod|build\.gradle(\.kts)?|pom\.xml|\.csproj|pubspec\.yaml)$/;
    const reviewableFiles = diff.files.filter(f => !shouldSkipFile(f.path));
    const isDependencyOnlyPR = reviewableFiles.length > 0 &&
      reviewableFiles.every(f => {
        const base = f.path.split('/').pop() ?? f.path;
        return MANIFEST_PATTERN.test(base) && (f.additions + f.deletions) <= 10;
      });
    if (isDependencyOnlyPR) {
      console.log(`[review] Dependency-only PR detected (${reviewableFiles.map(f => f.path).join(', ')}) — auto-approving, no LLM call.`);
      return {
        summary: 'Only dependency version changes detected. No code logic was modified.',
        comments: [],
        suggestions: [],
        verdict: 'approve',
      };
    }

    // 2. Get linked tickets (opt-in — ticket integration is behind a feature flag)
    const tickets = [];
    if (this.config.review?.ticketFetchEnabled) {
      const linkedTicketIds = await this.vcs.getLinkedTickets(prId);
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
    }

    // 3. Load applicable skills
    const applicableSkills = await this.skills.matchSkills(
      files.map(f => f.path)
    );

    // 3b. Load best_practices.md files from VCS (gracefully degraded)
    let bestPractices: string | undefined;
    const bestPracticesEnabled = this.config.review?.bestPracticesEnabled !== false;
    if (bestPracticesEnabled) {
      try {
        const maxChars = this.config.review?.bestPracticesMaxChars ?? 3000;
        const loaded = await loadBestPractices(this.vcs, diff, pr.targetBranch, maxChars);
        if (loaded) {
          bestPractices = loaded;
          console.log(`📋 Loaded best_practices.md (${loaded.length} chars)`);
        }
      } catch {
        // VCS call failed — skip silently
      }
    }

    // 4. Build context
    const context: ReviewContext = {
      pr,
      diff,
      files,
      tickets,
      skills: applicableSkills,
      config: this.config.review,
      graphContext,
      bestPractices,
      symbolExplorer,
      libraryDocs,
    };

    // 5. Run review (single-agent or specialist orchestration)
    const result =
      (await runReviewWithSpecialists(this.llm, context)) ??
      (await this.llm.generateReview(context));

    // 5b. Self-reflection second pass (single-agent path only; multi-agent wires it internally)
    const selfReflectionEnabled = this.config.review?.selfReflectionEnabled;
    const isMultiAgent = Array.isArray((result as any).agentTelemetry) && (result as any).agentTelemetry.length > 0;
    if (selfReflectionEnabled && !isMultiAgent) {
      const reflThreshold = this.config.review?.selfReflectionThreshold ?? 5;
      result.comments = await runSelfReflection(this.llm, context, result.comments, reflThreshold);
    }

    // 5c. Inline suggestion validation (tree-sitter syntax check)
    if (result.comments.some(c => c.suggestion)) {
      const parseFn = await getSyntaxParser();
      result.comments = await validateSuggestions(result.comments, files, parseFn);
    }

    // 6. Precision filter — drop low-confidence comments
    const threshold = this.config.review?.precisionThreshold ?? 0.7;
    const { kept, filtered } = filterByConfidence(result.comments, { minConfidence: threshold });
    if (filtered.length > 0) {
      console.log(`🎯 Precision filter: ${kept.length}/${result.comments.length} comments kept (threshold ${threshold})`);
    }
    result.comments = kept.length > 0 ? kept : result.comments.filter(c => c.confidence === undefined);

    // 7. Deterministic consolidation — region dedup + severity budget
    result.comments = consolidateFindings(result.comments);

    // Attach aggregate PR quality score
    result.prScore = computePRScore(result.comments);

    // Cache diff and graph context for PR description generation
    this.lastDiff = diff;
    this.lastGraphContext = graphContext ?? null;

    return result;
  }

  async postReview(
    prId: string | number,
    result: ReviewResult,
    options: {
      updatePRDescription?: boolean
      prDescription?: {
        publishMode?: 'replace_pr' | 'comment'
        preserveOriginal?: boolean
        useMarkers?: boolean
        publishLabels?: boolean
      }
    } = {}
  ): Promise<void> {
    const { summary, verdict } = result;

    // Build a set of canonical diff paths (normalised: no leading slash) for matching
    const diff = this.lastDiff ?? await this.vcs.getDiff(prId);
    const diffPathMap = new Map<string, string>(); // normalised → original
    // Build per-file set of added (+) line numbers for validation
    const changedLinesMap = new Map<string, Set<number>>(); // normalised path → Set of new-file line numbers
    for (const f of diff.files) {
      const key = f.path.replace(/^\//, '');
      diffPathMap.set(key, f.path);
      const addedLines = new Set<number>();
      for (const hunk of f.hunks) {
        let lineNo = hunk.newStart;
        for (const line of hunk.content.split('\n')) {
          if (line.startsWith('+')) {
            addedLines.add(lineNo++);
          } else if (!line.startsWith('-')) {
            lineNo++; // context line — advance new-file counter
          }
          // '-' lines don't advance the new-file line counter
        }
      }
      changedLinesMap.set(key, addedLines);
    }

    // Resolve each comment's path against actual diff paths and validate line is a + line
    const validComments: ReviewComment[] = [];
    for (const comment of result.comments) {
      const normalised = comment.path.replace(/^\//, '');
      const resolvedPath = diffPathMap.get(normalised);
      if (!resolvedPath) {
        console.warn(`⚠️  Skipping comment — path not in diff: ${comment.path}`);
        continue;
      }
      const addedLines = changedLinesMap.get(normalised);
      if (addedLines && addedLines.size > 0 && !addedLines.has(comment.line)) {
        console.warn(`⚠️  Skipping comment at ${comment.path}:${comment.line} — line is not a changed (+) line in this PR`);
        continue;
      }
      validComments.push({ ...comment, path: resolvedPath });
    }

    // PR split detection (deterministic heuristics + optional LLM analysis)
    const splitEnabled = this.config.review?.splitDetectionEnabled !== false;
    const splitFileThreshold = this.config.review?.splitFileThreshold ?? 15;
    if (splitEnabled) {
      try {
        const splitResult = await detectSplit(this.llm, diff, {
          pr: await this.vcs.getPR(prId),
          diff,
          files: [],
          tickets: [],
          skills: [],
          config: this.config.review,
        }, splitFileThreshold);
        if (splitResult?.shouldSplit) {
          result.splitSuggestion = splitResult;
          result.summary = result.summary + formatSplitSuggestion(splitResult);
        }
      } catch {
        // Split detection failed — skip silently
      }
    }

    // Submit overall review — body is the model-generated markdown, used as-is
    await this.vcs.submitReview(prId, {
      summary,
      comments: validComments,
      verdict
    });

    const shouldUpdatePRDescription =
      options.updatePRDescription !== false &&
      this.config.review?.enablePRDescription !== false;

    if (shouldUpdatePRDescription && this.vcs.updatePRDescription) {
      try {
        await this.generateAndUpdatePRDescription(prId, result, options.prDescription);
      } catch (error: any) {
        console.warn(`⚠️  Failed to update PR description: ${error.message}`);
      }
    }

    // Create checkpoint after successful review (only if not already handled by incrementalReview)
    if (!this.checkpointHandled && this.vcs instanceof GitHubAdapter) {
      await this.createCheckpointAfterReview(prId, result);
    }
  }

  private async generateAndUpdatePRDescription(
    prId: string | number,
    result: ReviewResult,
    behavior: {
      publishMode?: 'replace_pr' | 'comment'
      preserveOriginal?: boolean
      useMarkers?: boolean
      publishLabels?: boolean
    } = {}
  ): Promise<void> {
    const pr = await this.vcs.getPR(prId);
    const diff = this.lastDiff ?? await this.vcs.getDiff(prId);
    const files = await this.vcs.getFiles(prId);

    const context: ReviewContext = {
      pr,
      diff,
      files,
      tickets: [],
      skills: [],
      config: this.config.review
    };

    const description = await this.llm.generatePRDescription(context, result);
    const publishMode = behavior.publishMode ?? 'replace_pr';
    const preserveOriginal = behavior.preserveOriginal ?? true;
    const useMarkers = behavior.useMarkers ?? false;
    const publishLabels = behavior.publishLabels ?? true;

    if (publishMode === 'comment') {
      const labelsText = description.labels.length > 0 ? description.labels.join(', ') : 'none';
      await this.vcs.addComment(prId, {
        path: '',
        line: 1,
        severity: 'info',
        body:
          `## PR Description Proposal\n\n` +
          `**Suggested Title:** ${description.title}\n` +
          `**Change Type:** ${description.changeType}\n` +
          `**Labels:** ${labelsText}\n\n` +
          `${description.body}`
      });
      console.log('📝 Posted PR description as a comment (publishMode=comment).');
      return;
    }

    // Append Mermaid call-graph diagram when graph context is available
    const mermaidDiagram = this.lastGraphContext
      ? serializeMermaidGraph(this.lastGraphContext)
      : '';
    let bodyToPublish = mermaidDiagram
      ? `${description.body}\n${mermaidDiagram}`
      : description.body;
    const markerStart = '<!-- AGNUSAI:START -->';
    const markerEnd = '<!-- AGNUSAI:END -->';

    if (useMarkers) {
      const existing = pr.description || '';
      const start = existing.indexOf(markerStart);
      const end = existing.indexOf(markerEnd);
      if (start === -1 || end === -1 || end < start) {
        console.log('📝 Skipping PR description update — markers not found.');
        return;
      }
      const before = existing.slice(0, start + markerStart.length).trimEnd();
      const after = existing.slice(end).trimStart();
      bodyToPublish = `${before}\n\n${description.body}\n\n${after}`;
    } else if (preserveOriginal && pr.description?.trim()) {
      bodyToPublish = `${pr.description.trim()}\n\n---\n\n## AgnusAI Description\n\n${description.body}`;
    }

    // Append PR quality score label
    const score = result.prScore;
    const scoreLabel = score !== undefined
      ? `quality: ${score}/100${score < 60 ? ' ⚠️' : ''}`
      : null;
    const labelsWithScore = publishLabels
      ? [...description.labels.slice(0, 3), ...(scoreLabel ? [scoreLabel] : [])]
      : [];

    await this.vcs.updatePRDescription!(prId, {
      ...description,
      body: bodyToPublish,
      labels: labelsWithScore,
    });
    console.log(`📝 Updated PR title/body and labels (${labelsWithScore.length} labels, score=${score ?? 'n/a'}).`);
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
