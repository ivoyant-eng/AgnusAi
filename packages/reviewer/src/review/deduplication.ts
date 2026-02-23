// Comment Deduplication and Edge Case Handling
// Comprehensive logic to prevent duplicate/outdated comments

import { createHash } from 'crypto';
import {
  ReviewComment,
  DetailedReviewComment,
  Diff,
  FileDiff,
  PullRequest,
  CommentMetadata,
  PRComment
} from '../types';
import { AGNUSAI_MARKER, AGNUSAI_META_MARKER_START, AGNUSAI_META_MARKER_END } from './thread';

/**
 * Configuration for deduplication behavior
 */
export interface DeduplicationConfig {
  /** Maximum comments per PR (for large PRs) */
  maxComments: number;
  /** Maximum comments per file */
  maxCommentsPerFile: number;
  /** Skip draft PRs entirely */
  skipDrafts: boolean;
  /** Be less strict on test files */
  lenientOnTests: boolean;
  /** Update existing comments if we have better suggestions */
  updateExistingComments: boolean;
  /** Skip files matching these patterns */
  skipPatterns: string[];
  /** Commit hash threshold for stale checkpoint (number of commits) */
  staleCheckpointThreshold: number;
}

/**
 * Default deduplication configuration
 */
export const DEFAULT_DEDUP_CONFIG: DeduplicationConfig = {
  maxComments: 25,
  maxCommentsPerFile: 5,
  skipDrafts: true,
  lenientOnTests: true,
  updateExistingComments: true,
  skipPatterns: [
    // Binary files
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg',
    '*.woff', '*.woff2', '*.ttf', '*.eot', '*.otf',
    '*.pdf', '*.zip', '*.tar.gz', '*.jar', '*.war',
    // Generated/Minified files
    '*.min.js', '*.min.css', '*.min.mjs',
 '*.d.ts', '*.d.ts.map',
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'Cargo.lock', 'Gemfile.lock', 'composer.lock', 'poetry.lock',
    // Build outputs
    'dist/**', 'build/**', 'out/**', '.next/**', '.nuxt/**',
    // Vendored code
    'node_modules/**', 'vendor/**', 'third_party/**',
    // Generated files
    '*.generated.*', '*.gen.*', '*.pb.go', '*_pb2.py',
    // Documentation (optional)
    '*.md', '*.txt', 'LICENSE*'
  ],
  staleCheckpointThreshold: 20
};

/**
 * File patterns that indicate test files
 */
const TEST_FILE_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /_test\.[tj]sx?$/,
  /__tests__\//,
  /test\//,
  /tests\//,
  /\.integration\.test\.[tj]sx?$/,
  /__mocks__\//
];

/**
 * File patterns to ALWAYS skip (can't comment on these meaningfully)
 */
const ALWAYS_SKIP_PATTERNS = [
  // Binary files
  /\.(png|jpe?g|gif|ico|svg|webp|bmp)$/i,
  /\.(woff2?|ttf|eot|otf)$/i,
  /\.(pdf|zip|tar\.gz|jar|war|class)$/i,
  // Lock files
  /-lock\.(json|yaml)$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^(Cargo|Gemfile|composer|poetry)\.lock$/,
  // Minified
  /\.min\.(js|css|mjs)$/i,
  // Generated type definitions
  /\.d\.ts$/,
  /\.d\.ts\.map$/,
  // Protocol Buffers compiled output
  /\.pb\.(js|ts|jsx|tsx)$/i,
  // gRPC compiled output
  /_pb\.(js|ts|jsx|tsx)$/i,
  // GraphQL / Apollo codegen
  /\.generated\.(ts|js|tsx|jsx)$/i,
  /\.gen\.(ts|js|tsx|jsx)$/i,
  /__generated__\//,
];

/**
 * Patterns that indicate the LLM is making a claim about a package version —
 * these are unreliable due to knowledge cutoff and must be filtered out.
 */
const VERSION_CLAIM_PATTERNS = [
  // "version X does not exist / is invalid / doesn't exist"
  /version\s+`?[\d]+\.[\d][\d.]*`?\s+(does not exist|doesn't exist|is invalid|is not (published|available|released|real))/i,
  // "the latest (major/stable/current) version is X"
  /\b(latest|current|stable)\s+(major\s+)?version\s+is\s+[\d]+\./i,
  // "as of current releases / as of now, X is at version"
  /as of (current|today|now|this writing).{0,40}version\s+[\d]+\./i,
  // "X doesn't exist as of current releases"
  /doesn'?t exist as of/i,
  // "the current latest X version is" / "X's current latest"
  /current(ly)?[\s,]+latest.{0,30}version/i,
  // "there is no version X" / "no such version"
  /\bthere is no .{0,30}version\s+[\d]+/i,
  // "update the version to X (e.g., ^X.Y.Z)" when claiming latest
  /update.{0,40}to the latest (stable )?release/i,
  // "Storybook / package X is only at version"
  /is only at version\s+[\d]+\./i,
];

/**
 * Returns true if the comment body makes unreliable version-existence claims
 */
export function containsVersionClaim(body: string): boolean {
  return VERSION_CLAIM_PATTERNS.some(pattern => pattern.test(body));
}

/**
 * Dismissal keywords in comment replies
 */
const DISMISSAL_KEYWORDS = [
  'wontfix', 'won\'t fix', 'will not fix',
  'as designed', 'by design', 'intended',
  'false positive', 'false positive',
  'resolved', 'fixed', 'done',
  'nit', 'nits', 'nitpick',
  'ignore', 'skipping', 'skip'
];

/**
 * Reason why a comment was filtered
 */
export type FilterReason =
  | 'duplicate_line'
  | 'duplicate_issue'
  | 'code_changed'
  | 'dismissed'
  | 'line_deleted'
  | 'file_renamed'
  | 'file_deleted'
  | 'binary_file'
  | 'generated_file'
  | 'skip_pattern'
  | 'draft_pr'
  | 'merged_pr'
  | 'closed_pr'
  | 'line_not_in_diff'
  | 'rate_limited'
  | 'max_comments_reached'
  | 'max_comments_per_file'
  | 'stale_checkpoint'
  | 'invalid_line_number'
  | 'empty_comment'
  | 'test_file_lenient'
  | 'outdated_review'
  | 'version_claim';

/**
 * Result of filtering a single comment
 */
export interface CommentFilterResult {
  comment: ReviewComment;
  shouldPost: boolean;
  reason?: FilterReason;
  existingCommentId?: number;
}

/**
 * Result of filtering all comments
 */
export interface FilteredComments {
  comments: ReviewComment[];
  filtered: Array<{ comment: ReviewComment; reason: FilterReason }>;
  skippedFiles: string[];
  warnings: string[];
}

/**
 * Parse comment metadata from body
 */
export function parseCommentMetadata(body: string): CommentMetadata | null {
  if (!body.includes(AGNUSAI_META_MARKER_START)) {
    return null;
  }
  
  try {
    const start = body.indexOf(AGNUSAI_META_MARKER_START) + AGNUSAI_META_MARKER_START.length;
    const end = body.indexOf(AGNUSAI_META_MARKER_END, start);
    
    if (start === -1 || end === -1) return null;
    
    const metaStr = body.slice(start, end).trim();
    return JSON.parse(metaStr);
  } catch {
    return null;
  }
}

/**
 * Generate comment metadata string
 */
export function generateCommentMetadata(
  commitSha: string,
  issueId: string,
  originalCode?: string
): string {
  const meta: CommentMetadata = {
    commitSha,
    issueId,
    originalCode,
    timestamp: Date.now()
  };
  
  return `${AGNUSAI_META_MARKER_START} ${JSON.stringify(meta)} ${AGNUSAI_META_MARKER_END}`;
}

/**
 * Check if a comment belongs to AgnusAI
 */
export function isAgnusaiComment(comment: { body: string }): boolean {
  return comment.body.trim().endsWith(AGNUSAI_MARKER);
}

/**
 * Check if a comment was dismissed by user replies
 */
export function isCommentDismissed(comment: DetailedReviewComment, allComments: DetailedReviewComment[]): boolean {
  // Find user replies to this comment (not the comment itself)
  const replies = allComments.filter(c => c.inReplyToId === comment.id);

  for (const reply of replies) {
    const body = reply.body.toLowerCase();
    for (const keyword of DISMISSAL_KEYWORDS) {
      if (body.includes(keyword.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a file is a binary or generated file
 */
export function shouldSkipFile(path: string, config: DeduplicationConfig): boolean {
  // Check always-skip patterns
  for (const pattern of ALWAYS_SKIP_PATTERNS) {
    if (pattern.test(path)) {
      return true;
    }
  }
  
  // Check configured skip patterns
  const patterns = config.skipPatterns;
  for (const pattern of patterns) {
    if (matchGlob(path, pattern)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Simple glob matcher
 */
function matchGlob(path: string, pattern: string): boolean {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<DOUBLE_STAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<DOUBLE_STAR>>/g, '.*')
    .replace(/\?/g, '[^/]');
  
  const regex = new RegExp(`(^|/)${regexPattern}$`, 'i');
  return regex.test(path);
}

/**
 * Check if a file is a test file
 */
export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some(pattern => pattern.test(path));
}

/**
 * Get the lines that actually changed in a file diff
 */
export function getChangedLines(file: FileDiff): Set<number> {
  const changedLines = new Set<number>();
  
  for (const hunk of file.hunks) {
    let currentLine = hunk.newStart;
    const lines = hunk.content.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        changedLines.add(currentLine);
        currentLine++;
      } else if (!line.startsWith('-') && !line.startsWith('\\') && !line.startsWith('@@')) {
        currentLine++;
      }
    }
  }
  
  return changedLines;
}

/**
 * Get current line numbers for a file (mapping old lines to new lines after changes)
 */
export function trackLineMovement(file: FileDiff): Map<number, number> {
  const lineMap = new Map<number, number>();
  
  for (const hunk of file.hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    
    const lines = hunk.content.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        // Line added - new line exists
        lineMap.set(newLine, newLine);
        newLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Line deleted - old line no longer exists
        lineMap.set(oldLine, -1); // -1 means deleted
        oldLine++;
      } else if (!line.startsWith('\\') && !line.startsWith('@@')) {
        // Context line - maps old to new
        lineMap.set(oldLine, newLine);
        oldLine++;
        newLine++;
      }
    }
  }
  
  return lineMap;
}

/**
 * Generate a unique issue ID based on comment content
 */
export function generateIssueId(comment: ReviewComment): string {
  const content = `${comment.path}:${comment.line}:${comment.body}`;
  return 'issue-' + createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Main deduplication filter for comments
 */
export function filterComments(
  newComments: ReviewComment[],
  existingComments: DetailedReviewComment[],
  diff: Diff,
  pr: PullRequest,
  config: DeduplicationConfig = DEFAULT_DEDUP_CONFIG
): FilteredComments {
  const result: FilteredComments = {
    comments: [],
    filtered: [],
    skippedFiles: [],
    warnings: []
  };
  
  // Build maps for efficient lookup
  const existingByPathLine = new Map<string, DetailedReviewComment>();
  const existingByPathIssue = new Map<string, DetailedReviewComment>();
  const fileChangedLines = new Map<string, Set<number>>();
  const fileLineMovements = new Map<string, Map<number, number>>();
  const fileDiffs = new Map<string, FileDiff>();
  const commentsPerFile = new Map<string, number>();
  
  // Index existing comments
  for (const ec of existingComments) {
    if (ec.path && ec.line) {
      const key = `${ec.path}:${ec.line}`;
      existingByPathLine.set(key, ec);
    }
    
    // Track by issue if we can extract it
    const meta = parseCommentMetadata(ec.body);
    if (meta && ec.path) {
      const issueKey = `${ec.path}:${meta.issueId}`;
      existingByPathIssue.set(issueKey, ec);
    }
  }
  
  // Build diff maps
  for (const file of diff.files) {
    fileDiffs.set(file.path, file);
    fileChangedLines.set(file.path, getChangedLines(file));
    fileLineMovements.set(file.path, trackLineMovement(file));
    
    // Track skipped files
    if (shouldSkipFile(file.path, config)) {
      result.skippedFiles.push(file.path);
    }
  }
  
  // Check PR state
  const isDraft = (pr as any).draft === true || (pr as any).isDraft === true;
  if (isDraft && config.skipDrafts) {
    result.warnings.push('Skipping review: PR is a draft');
    return result;
  }
  
  // Filter each new comment
  for (const comment of newComments) {
    const filterResult = shouldPostComment(
      comment,
      existingByPathLine,
      existingByPathIssue,
      existingComments,
      fileDiffs,
      fileChangedLines,
      fileLineMovements,
      commentsPerFile,
      result.comments.length,
      config
    );
    
    if (filterResult.shouldPost) {
      result.comments.push(comment);
      
      // Track comments per file
      const count = commentsPerFile.get(comment.path) || 0;
      commentsPerFile.set(comment.path, count + 1);
    } else {
      result.filtered.push({
        comment,
        reason: filterResult.reason!
      });
    }
    
    // Stop if we've reached max comments
    if (result.comments.length >= config.maxComments) {
      result.warnings.push(`Reached maximum comments (${config.maxComments}). Remaining comments filtered.`);
      break;
    }
  }
  
  return result;
}

/**
 * Determine if a comment should be posted
 */
function shouldPostComment(
  comment: ReviewComment,
  existingByPathLine: Map<string, DetailedReviewComment>,
  existingByPathIssue: Map<string, DetailedReviewComment>,
  allExistingComments: DetailedReviewComment[],
  fileDiffs: Map<string, FileDiff>,
  fileChangedLines: Map<string, Set<number>>,
  fileLineMovements: Map<string, Map<number, number>>,
  commentsPerFile: Map<string, number>,
  currentCommentCount: number,
  config: DeduplicationConfig
): CommentFilterResult {
  // Edge case: Invalid line number
  if (!comment.line || comment.line < 1 || !isFinite(comment.line)) {
    return { comment, shouldPost: false, reason: 'invalid_line_number' };
  }
  
  // Edge case: Empty comment body
  if (!comment.body || comment.body.trim().length === 0) {
    return { comment, shouldPost: false, reason: 'empty_comment' };
  }

  // Edge case: LLM is making unreliable version-existence claims (knowledge cutoff)
  if (containsVersionClaim(comment.body)) {
    return { comment, shouldPost: false, reason: 'version_claim' };
  }

  // Edge case: Binary/generated files
  if (shouldSkipFile(comment.path, config)) {
    return { comment, shouldPost: false, reason: 'binary_file' };
  }
  
  // Edge case: File not in diff (deleted/renamed)
  const fileDiff = fileDiffs.get(comment.path);
  if (!fileDiff) {
    // Check if file was renamed
    for (const [_, diff] of fileDiffs) {
      if (diff.oldPath === comment.path) {
        return { comment, shouldPost: false, reason: 'file_renamed' };
      }
    }
    return { comment, shouldPost: false, reason: 'file_deleted' };
  }
  
  // Edge case: Line not in diff (unchanged or deleted)
  const changedLines = fileChangedLines.get(comment.path);
  if (changedLines && !changedLines.has(comment.line)) {
    return { comment, shouldPost: false, reason: 'line_not_in_diff' };
  }
  
  // Edge case: Line was deleted
  const lineMovements = fileLineMovements.get(comment.path);
  if (lineMovements) {
    const newLine = lineMovements.get(comment.line);
    if (newLine === -1) {
      return { comment, shouldPost: false, reason: 'line_deleted' };
    }
  }
  
  // Edge case: Duplicate comment at same (path, line)
  const pathLineKey = `${comment.path}:${comment.line}`;
  const existingAtLine = existingByPathLine.get(pathLineKey);
  if (existingAtLine) {
    return { 
      comment, 
      shouldPost: false, 
      reason: 'duplicate_line',
      existingCommentId: existingAtLine.id
    };
  }
  
  // Edge case: Same issue already mentioned (possibly at different line due to movement)
  const issueId = generateIssueId(comment);
  const issueKey = `${comment.path}:${issueId}`;
  const existingIssue = existingByPathIssue.get(issueKey);
  if (existingIssue && existingIssue.line !== comment.line) {
    // Issue exists at different line - check if code is still the same
    const meta = parseCommentMetadata(existingIssue.body);
    if (meta?.originalCode) {
      // If code changed, the issue might be fixed - skip
      // (In real implementation, we'd compare with current file content)
      return { 
        comment, 
        shouldPost: false, 
        reason: 'code_changed',
        existingCommentId: existingIssue.id
      };
    }
  }
  
  // Edge case: Comment was dismissed
  if (existingIssue && isCommentDismissed(existingIssue, allExistingComments)) {
    return { 
      comment, 
      shouldPost: false, 
      reason: 'dismissed',
      existingCommentId: existingIssue.id
    };
  }
  
  // Edge case: Max comments per file
  const fileCommentCount = commentsPerFile.get(comment.path) || 0;
  if (fileCommentCount >= config.maxCommentsPerFile) {
    return { comment, shouldPost: false, reason: 'max_comments_per_file' };
  }
  
  // Edge case: Lenient on test files
  if (config.lenientOnTests && isTestFile(comment.path) && comment.severity !== 'error') {
    // Only post errors on test files, skip warnings and info
    return { comment, shouldPost: false, reason: 'test_file_lenient' };
  }
  
  return { comment, shouldPost: true };
}

/**
 * Check if a PR state prevents reviewing
 */
export function checkPRState(pr: PullRequest): { canReview: boolean; reason?: string } {
  // Check if merged
  if ((pr as any).mergedAt || (pr as any).merged_at) {
    return { canReview: false, reason: 'PR is already merged' };
  }
  
  // Check if closed
  if ((pr as any).state === 'closed') {
    return { canReview: false, reason: 'PR is closed' };
  }
  
  // Check if draft
  if ((pr as any).draft === true) {
    return { canReview: false, reason: 'PR is a draft' };
  }
  
  return { canReview: true };
}

/**
 * Generate idempotency key for a comment (for concurrent request handling)
 */
export function generateIdempotencyKey(
  commitSha: string,
  path: string,
  line: number,
  issueId: string
): string {
  return `review-${commitSha.slice(0, 7)}-${path.replace(/[^a-zA-Z0-9]/g, '_')}-${line}-${issueId}`;
}

/**
 * Rate limit tracker (simple in-memory implementation)
 */
class RateLimitTracker {
  private requests: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;
  
  constructor(limit: number = 5000, windowMs: number = 3600000) { // 5000 req/hour default
    this.limit = limit;
    this.windowMs = windowMs;
  }
  
  checkLimit(): { allowed: boolean; remaining: number; resetIn?: number } {
    const now = Date.now();
    
    // Remove old requests outside window
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    
    if (this.requests.length >= this.limit) {
      const oldestRequest = Math.min(...this.requests);
      const resetIn = this.windowMs - (now - oldestRequest);
      return { allowed: false, remaining: 0, resetIn };
    }
    
    return { allowed: true, remaining: this.limit - this.requests.length };
  }
  
  recordRequest(): void {
    this.requests.push(Date.now());
  }
}

// Export singleton instance
export const rateLimitTracker = new RateLimitTracker();

/**
 * Priority-based comment sorting
 * Critical errors first, then warnings, then info
 */
export function sortCommentsByPriority(comments: ReviewComment[]): ReviewComment[] {
  const severityOrder = { error: 0, warning: 1, info: 2 };
  
  return [...comments].sort((a, b) => {
    const priorityDiff = (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
    if (priorityDiff !== 0) return priorityDiff;
    
    // Secondary sort by path for consistency
    return a.path.localeCompare(b.path) || a.line - b.line;
  });
}

/**
 * Consolidate similar comments across files
 * Returns suggestions for summary instead of individual comments
 */
export function consolidateComments(
  comments: ReviewComment[]
): { individual: ReviewComment[]; consolidated: Map<string, ReviewComment[]> } {
  const consolidated = new Map<string, ReviewComment[]>();
  const individual: ReviewComment[] = [];
  
  // Group comments by issue prefix (first 20 chars of body)
  const byIssuePrefix = new Map<string, ReviewComment[]>();
  
  for (const comment of comments) {
    const prefix = comment.body.slice(0, 30).toLowerCase();
    const group = byIssuePrefix.get(prefix) || [];
    group.push(comment);
    byIssuePrefix.set(prefix, group);
  }
  
  // If same issue appears in 3+ files, consolidate
  for (const [prefix, group] of byIssuePrefix) {
    if (group.length >= 3) {
      consolidated.set(prefix, group);
    } else {
      individual.push(...group);
    }
  }
  
  return { individual, consolidated };
}