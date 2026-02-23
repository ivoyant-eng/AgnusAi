// GitHub VCS Adapter

import { Octokit } from '@octokit/rest';
import { VCSAdapter } from './base';
import {
  PullRequest,
  Diff,
  FileInfo,
  ReviewComment,
  Review,
  Ticket,
  Author,
  DiffHunk,
  FileDiff,
  CommitComparison,
  PRComment,
  ReviewCheckpoint,
  DetailedReviewComment
} from '../../types';
import { AGNUSAI_MARKER } from '../../review/thread';

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

export class GitHubAdapter implements VCSAdapter {
  readonly name = 'github';
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
  }

  async getPR(prId: string | number): Promise<PullRequest> {
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });

    return {
      id: String(pr.id),
      number: pr.number,
      title: pr.title,
      description: pr.body || '',
      author: {
        id: String(pr.user?.id),
        username: pr.user?.login || 'unknown',
        email: pr.user?.email ?? undefined
      },
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      url: pr.html_url,
      createdAt: new Date(pr.created_at),
      updatedAt: new Date(pr.updated_at)
    };
  }

  async getDiff(prId: string | number): Promise<Diff> {
    const response = await this.octokit.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId),
      per_page: 100
    });

    // Get the actual diff content
    const diffResponse = await this.octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      {
        owner: this.owner,
        repo: this.repo,
        pull_number: Number(prId),
        headers: { Accept: 'application/vnd.github.v3.diff' }
      }
    );

    const diffText = String(diffResponse.data);
    const files = this.parseDiff(diffText, response.data);

    return {
      files,
      additions: response.data.reduce((sum, f) => sum + f.additions, 0),
      deletions: response.data.reduce((sum, f) => sum + f.deletions, 0),
      changedFiles: response.data.length
    };
  }

  private parseDiff(diffText: string, filesData: any[]): FileDiff[] {
    const fileDiffs: FileDiff[] = [];
    const fileBlocks = diffText.split(/^diff --git /m).filter(Boolean);

    for (let i = 0; i < fileBlocks.length && i < filesData.length; i++) {
      const block = fileBlocks[i];
      const fileInfo = filesData[i];
      const hunks = this.parseHunks(block);
      
      let status: FileDiff['status'] = 'modified';
      if (fileInfo.status === 'added') status = 'added';
      else if (fileInfo.status === 'removed') status = 'deleted';
      else if (fileInfo.status === 'renamed') status = 'renamed';

      // Handle both 'filename' (from GitHub API) and 'path' (from compareCommits)
      const filePath = fileInfo.filename || fileInfo.path;
      
      fileDiffs.push({
        path: filePath,
        oldPath: fileInfo.previous_filename,
        status,
        additions: fileInfo.additions || 0,
        deletions: fileInfo.deletions || 0,
        hunks
      });
    }

    return fileDiffs;
  }

  private parseHunks(diffBlock: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const hunkRegex = /@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/g;
    let match;

    while ((match = hunkRegex.exec(diffBlock)) !== null) {
      const [fullMatch, oldStart, oldLines, newStart, newLines] = match;
      
      // Extract hunk content
      const startIndex = match.index + fullMatch.length;
      let endIndex = diffBlock.indexOf('@@ ', startIndex);
      if (endIndex === -1) endIndex = diffBlock.length;
      
      const content = diffBlock.slice(startIndex, endIndex).trim();

      hunks.push({
        oldStart: parseInt(oldStart) || 1,
        oldLines: parseInt(oldLines) || 0,
        newStart: parseInt(newStart) || 1,
        newLines: parseInt(newLines) || 0,
        content
      });
    }

    return hunks;
  }

  async getFiles(prId: string | number): Promise<FileInfo[]> {
    const { data: files } = await this.octokit.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId),
      per_page: 100
    });

    return files.map(file => ({
      path: file.filename,
      language: this.detectLanguage(file.filename)
    }));
  }

  private detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      kt: 'kotlin',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      css: 'css',
      scss: 'scss',
      html: 'html',
      sql: 'sql',
      sh: 'bash',
      dockerfile: 'dockerfile'
    };
    return langMap[ext] || 'text';
  }

  /**
   * Add the AgnusAI marker to a comment body
   * This identifies our comments for reply handling
   */
  private addAgnusaiMarker(body: string): string {
    // Don't add marker if already present
    if (body.trim().endsWith(AGNUSAI_MARKER)) {
      return body;
    }
    return `${body.trim()}\n\n${AGNUSAI_MARKER}`;
  }

  /**
   * Create a reply to a review comment
   * GitHub only allows one level of replies (no nested threads)
   * 
   * @param prId PR number
   * @param commentId The root comment ID to reply to
   * @param body The reply body
   */
  async createReply(
    prId: string | number,
    commentId: number,
    body: string
  ): Promise<void> {
    const markedBody = this.addAgnusaiMarker(body);
    
    await this.octokit.pulls.createReplyForReviewComment({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId),
      comment_id: commentId,
      body: markedBody
    });
  }

  /**
   * Get a specific review comment by ID
   * Useful for checking if a comment is from AgnusAI
   * 
   * @param commentId The review comment ID
   * @returns The comment data
   */
  async getReviewComment(commentId: number): Promise<DetailedReviewComment> {
    const { data: comment } = await this.octokit.pulls.getReviewComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId
    });

    return {
      id: comment.id,
      body: comment.body || '',
      user: {
        login: comment.user?.login || 'unknown',
        type: comment.user?.type || 'User'
      },
      path: comment.path,
      line: comment.line ?? comment.original_line ?? null,
      originalLine: comment.original_line ?? null,
      position: comment.position ?? null,
      commitId: comment.commit_id,
      inReplyToId: comment.in_reply_to_id ?? null,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      htmlUrl: comment.html_url
    };
  }

  async addComment(prId: string | number, comment: ReviewComment): Promise<void> {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: Number(prId),
      body: comment.body
    });
  }

  async addInlineComment(
    prId: string | number,
    path: string,
    line: number,
    body: string,
    severity: 'info' | 'warning' | 'error' = 'info'
  ): Promise<void> {
    const severityEmoji = {
      info: '💡',
      warning: '⚠️',
      error: '🚨'
    };

    // Get the PR to find the head commit SHA
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });

    await this.octokit.pulls.createReviewComment({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId),
      path,
      line,
      body: `${severityEmoji[severity]} ${body}`,
      commit_id: pr.head.sha
    });
  }

  async submitReview(prId: string | number, review: Review): Promise<void> {
    // Get the head commit SHA for inline comments
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });

    // Get the diff to find correct line positions
    const diffResponse = await this.octokit.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });

    // Build a map of file -> changed lines for validation
    const changedFiles = new Map<string, Set<number>>();
    for (const file of diffResponse.data) {
      if (file.changes && file.changes > 0) {
        // Parse the patch to find changed line numbers
        const changedLines = new Set<number>();
        if (file.patch) {
          const lines = file.patch.split('\n');
          let currentLine = 0;
          for (const line of lines) {
            const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (hunkMatch) {
              currentLine = parseInt(hunkMatch[1]);
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
              changedLines.add(currentLine);
              currentLine++;
            } else if (!line.startsWith('-') && !line.startsWith('\\')) {
              currentLine++;
            }
          }
        }
        changedFiles.set(file.filename, changedLines);
      }
    }

    // Format comments for GitHub API - only include if line exists in diff
    // Add AgnusAI marker to each comment for reply detection
    const comments = review.comments
      .filter(c => {
        const fileLines = changedFiles.get(c.path);
        return fileLines && fileLines.has(c.line);
      })
      .map(c => ({
        path: c.path,
        line: c.line,
        body: this.addAgnusaiMarker(c.body),
        side: 'RIGHT' as const
      }));

    const eventMap: Record<string, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
      approve: 'APPROVE',
      request_changes: 'REQUEST_CHANGES',
      comment: 'COMMENT'
    };

    try {
      await this.octokit.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: Number(prId),
        event: eventMap[review.verdict],
        body: review.summary,
        comments,
        commit_id: pr.head.sha
      });
    } catch (error: any) {
      // Fall back to COMMENT if APPROVE or REQUEST_CHANGES fails on own PR
      const isOwnPrError = error.message?.includes('your own pull request');
      if (isOwnPrError && (review.verdict === 'request_changes' || review.verdict === 'approve')) {
        console.log(`⚠️  Cannot ${review.verdict === 'approve' ? 'approve' : 'request changes on'} own PR, posting as comment instead...`);
        await this.octokit.pulls.createReview({
          owner: this.owner,
          repo: this.repo,
          pull_number: Number(prId),
          event: 'COMMENT',
          body: review.summary + `\n\n> ⚠️ **Note:** Would have ${review.verdict === 'approve' ? 'approved' : 'requested changes'}, but this is your own PR.`,
          comments,
          commit_id: pr.head.sha
        });
      } else {
        throw error;
      }
    }
  }

  async getLinkedTickets(prId: string | number): Promise<Ticket[]> {
    const pr = await this.getPR(prId);
    // Parse ticket IDs from PR description and title
    const ticketPatterns = [
      /\b([A-Z]+-\d+)\b/g,  // Jira: PROJ-123
      /\b([A-Z]{2,}-\d+)\b/g, // Linear: ENG-123
      /#(\d+)/g              // GitHub Issues: #123
    ];

    const tickets: Ticket[] = [];
    const text = `${pr.title} ${pr.description}`;

    // For now, just extract IDs - actual fetching requires ticket adapters
    for (const pattern of ticketPatterns) {
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        tickets.push({
          id: match.replace('#', ''),
          key: match.replace('#', ''),
          title: 'Linked ticket',
          description: '',
          status: 'unknown',
          type: 'unknown',
          labels: []
        });
      }
    }

    return tickets;
  }

  async getAuthor(prId: string | number): Promise<Author> {
    const pr = await this.getPR(prId);
    return pr.author;
  }

  async getFileContent(path: string, ref?: string): Promise<string> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: ref || 'main'
      });

      if ('content' in data) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return '';
    } catch {
      return '';
    }
  }

  // ============================================
  // Incremental Review Methods
  // ============================================

  /**
   * Compare two commits and return the diff between them
   * Uses GitHub's Compare API
   * 
   * @param baseSha The base commit SHA (checkpoint SHA)
   * @param headSha The head commit SHA (current HEAD)
   * @returns CommitComparison with files changed and stats
   */
  async compareCommits(baseSha: string, headSha: string): Promise<CommitComparison> {
    const { data: comparison } = await this.octokit.repos.compareCommits({
      owner: this.owner,
      repo: this.repo,
      base: baseSha,
      head: headSha,
      per_page: 100
    });

    // Map GitHub files to FileDiff
    const files: FileDiff[] = (comparison.files || []).map(file => {
      let status: FileDiff['status'] = 'modified';
      if (file.status === 'added') status = 'added';
      else if (file.status === 'removed') status = 'deleted';
      else if (file.status === 'renamed') status = 'renamed';

      return {
        path: file.filename,
        oldPath: file.previous_filename,
        status,
        additions: file.additions || 0,
        deletions: file.deletions || 0,
        hunks: [] // Hunks would need additional API call to get full diff
      };
    });

    // Determine status
    let status: CommitComparison['status'] = 'identical';
    if (comparison.ahead_by > 0 && comparison.behind_by > 0) {
      status = 'diverged';
    } else if (comparison.ahead_by > 0) {
      status = 'ahead';
    } else if (comparison.behind_by > 0) {
      status = 'behind';
    }

    return {
      baseSha,
      headSha,
      status,
      aheadBy: comparison.ahead_by,
      behindBy: comparison.behind_by,
      files,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0)
    };
  }

  /**
   * Get all issue comments on a PR (not review comments)
   * Used to find checkpoint comments
   * 
   * @param prId PR number
   * @returns List of PR comments
   */
  async getPRComments(prId: string | number): Promise<PRComment[]> {
    const { data: comments } = await this.octokit.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: Number(prId),
      per_page: 100
    });

    return comments.map(comment => ({
      id: comment.id,
      body: comment.body || '',
      user: {
        login: comment.user?.login || 'unknown',
        type: comment.user?.type || 'User'
      },
      createdAt: comment.created_at,
      updatedAt: comment.updated_at
    }));
  }

  /**
   * Get all review comments on a PR (inline comments on code)
   * Handles pagination to fetch ALL comments
   * 
   * @param prId PR number
   * @returns List of detailed review comments
   */
  async getReviewComments(prId: string | number): Promise<DetailedReviewComment[]> {
    const comments: DetailedReviewComment[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;
    
    while (hasMore) {
      const { data: pageComments } = await this.octokit.pulls.listReviewComments({
        owner: this.owner,
        repo: this.repo,
        pull_number: Number(prId),
        per_page: perPage,
        page
      });
      
      for (const comment of pageComments) {
        comments.push({
          id: comment.id,
          body: comment.body || '',
          user: {
            login: comment.user?.login || 'unknown',
            type: comment.user?.type || 'User'
          },
          path: comment.path,
          line: comment.line ?? comment.original_line ?? null,
          originalLine: comment.original_line ?? null,
          position: comment.position ?? null,
          commitId: comment.commit_id,
          inReplyToId: comment.in_reply_to_id ?? null,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          htmlUrl: comment.html_url
        });
      }
      
      hasMore = pageComments.length === perPage;
      page++;
      
      // Safety limit
      if (page > 10) {
        console.warn('Reached maximum pages fetching review comments');
        break;
      }
    }

    return comments;
  }

  /**
   * Create a checkpoint comment on a PR
   * 
   * @param prId PR number
   * @param checkpoint The checkpoint to store
   * @returns The created comment ID
   */
  async createCheckpointComment(
    prId: string | number,
    checkpoint: ReviewCheckpoint
  ): Promise<number> {
    const body = this.generateCheckpointBody(checkpoint);

    const { data: comment } = await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: Number(prId),
      body
    });

    return comment.id;
  }

  /**
   * Update an existing checkpoint comment
   * 
   * @param commentId The comment ID to update
   * @param checkpoint The new checkpoint data
   */
  async updateCheckpointComment(
    commentId: number,
    checkpoint: ReviewCheckpoint
  ): Promise<void> {
    const body = this.generateCheckpointBody(checkpoint);

    await this.octokit.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      body
    });
  }

  /**
   * Delete a checkpoint comment
   * 
   * @param commentId The comment ID to delete
   */
  async deleteCheckpointComment(commentId: number): Promise<void> {
    await this.octokit.issues.deleteComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId
    });
  }

  /**
   * Generate the checkpoint comment body
   */
  private generateCheckpointBody(checkpoint: ReviewCheckpoint): string {
    const dateStr = new Date(checkpoint.timestamp * 1000).toISOString();
    
    return `<!-- AGNUSAI_CHECKPOINT: ${JSON.stringify({
      sha: checkpoint.sha,
      timestamp: checkpoint.timestamp,
      filesReviewed: checkpoint.filesReviewed,
      commentCount: checkpoint.commentCount,
      verdict: checkpoint.verdict
    })} -->

## 🔍 AgnusAI Review Checkpoint

**Last reviewed commit:** \`${checkpoint.sha.substring(0, 7)}\`
**Reviewed at:** ${dateStr}
**Files reviewed:** ${checkpoint.filesReviewed.length}
**Comments:** ${checkpoint.commentCount}
**Verdict:** ${checkpoint.verdict === 'approve' ? '✅ Approved' : checkpoint.verdict === 'request_changes' ? '🔄 Changes Requested' : '💬 Commented'}

---
*This checkpoint enables incremental reviews. New commits will only trigger review of new changes.*`;
  }

  /**
   * Get the current HEAD SHA of a PR
   * 
   * @param prId PR number  
   * @returns The HEAD commit SHA
   */
  async getHeadSha(prId: string | number): Promise<string> {
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });
    return pr.head.sha;
  }

  /**
   * Get incremental diff for a PR since a checkpoint
   *
   * @param prId PR number
   * @param checkpointSha The SHA from the last checkpoint
   * @returns Incremental diff or null if full review needed
   */
  async getIncrementalDiff(
    prId: string | number,
    checkpointSha: string
  ): Promise<{ diff: Diff; isIncremental: true } | { diff: null; isIncremental: false; reason: string }> {
    const headSha = await this.getHeadSha(prId);

    console.log(`📊 Comparing commits: checkpoint=${checkpointSha.substring(0, 7)} HEAD=${headSha.substring(0, 7)}`);

    // If no new commits, no diff needed
    if (headSha === checkpointSha) {
      console.log('✓ No new commits since checkpoint');
      return {
        diff: { files: [], additions: 0, deletions: 0, changedFiles: 0 },
        isIncremental: true
      };
    }

    try {
      const comparison = await this.compareCommits(checkpointSha, headSha);

      console.log(`📊 Comparison status: ${comparison.status}, ahead_by=${comparison.aheadBy}, files=${comparison.files.length}`);
      console.log(`📁 Changed files from comparison: ${comparison.files.map(f => f.path).join(', ')}`);

      // If diverged or behind, we need a full review
      if (comparison.status === 'diverged') {
        return {
          diff: null,
          isIncremental: false,
          reason: 'Commits have diverged (possible force push)'
        };
      }

      if (comparison.status === 'behind') {
        return {
          diff: null,
          isIncremental: false,
          reason: 'Checkpoint SHA is ahead of current HEAD (unexpected)'
        };
      }

      // If identical, no changes
      if (comparison.status === 'identical') {
        console.log('✓ Commits are identical, no changes');
        return {
          diff: { files: [], additions: 0, deletions: 0, changedFiles: 0 },
          isIncremental: true
        };
      }

      // Ahead - we have incremental changes
      // Fetch full diff content to get hunks for proper review
      console.log(`📁 Fetching diff content for ${comparison.files.length} files...`);
      const diffResponse = await this.octokit.request(
        'GET /repos/{owner}/{repo}/compare/{basehead}',
        {
          owner: this.owner,
          repo: this.repo,
          basehead: `${checkpointSha}...${headSha}`,
          headers: { Accept: 'application/vnd.github.v3.diff' }
        }
      );

      const diffText = String(diffResponse.data);

      // Parse the diff to get hunks - use comparison files for metadata
      const files = this.parseDiff(diffText, comparison.files);
      console.log(`📁 Parsed ${files.length} files with hunks from diff`);

      return {
        diff: {
          files,
          additions: comparison.additions,
          deletions: comparison.deletions,
          changedFiles: comparison.files.length
        },
        isIncremental: true
      };
    } catch (error: any) {
      // If the checkpoint SHA doesn't exist (e.g., force push), do full review
      if (error.status === 404 || error.message?.includes('not found')) {
        return {
          diff: null,
          isIncremental: false,
          reason: 'Checkpoint SHA not found in repository'
        };
      }
      throw error;
    }
  }

  // ============================================
  // PR State Methods
  // ============================================

  /**
   * Check if PR is a draft
   */
  async isDraft(prId: string | number): Promise<boolean> {
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });
    return pr.draft ?? false;
  }

  /**
   * Check if PR is merged
   */
  async isMerged(prId: string | number): Promise<boolean> {
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });
    return pr.merged ?? false;
  }

  /**
   * Check if PR is closed
   */
  async isClosed(prId: string | number): Promise<boolean> {
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });
    return pr.state === 'closed';
  }

  /**
   * Check if discussion is locked
   */
  async isLocked(prId: string | number): Promise<boolean> {
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId)
    });
    return pr.locked ?? false;
  }

  /**
   * Get file renames in a PR
   */
  async getFileRenames(prId: string | number): Promise<Array<{ oldPath: string; newPath: string }>> {
    const { data: files } = await this.octokit.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: Number(prId),
      per_page: 100
    });

    return files
      .filter(f => f.status === 'renamed')
      .map(f => ({
        oldPath: f.previous_filename || '',
        newPath: f.filename
      }));
  }

  /**
   * Find existing checkpoint comment
   */
  async findCheckpointComment(prId: string | number): Promise<PRComment | null> {
    const comments = await this.getPRComments(prId);
    
    // Find the most recent checkpoint comment
    const checkpointComments = comments.filter(c => 
      c.body.includes('AGNUSAI_CHECKPOINT') || c.body.includes('AgnusAI Review Checkpoint')
    );
    
    if (checkpointComments.length === 0) {
      return null;
    }
    
    // Return the most recent one
    return checkpointComments.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  /**
   * Update an existing review comment
   */
  async updateReviewComment(
    prId: string | number,
    commentId: string | number,
    body: string
  ): Promise<void> {
    await this.octokit.pulls.updateReviewComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: Number(commentId),
      body
    });
  }

  /**
   * Delete a review comment
   */
  async deleteReviewComment(
    prId: string | number,
    commentId: string | number
  ): Promise<void> {
    await this.octokit.pulls.deleteReviewComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: Number(commentId)
    });
  }

  /**
   * Get rate limit status
   */
  async getRateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date } | null> {
    try {
      const { data } = await this.octokit.rateLimit.get();
      const core = data.resources.core;
      return {
        limit: core.limit,
        remaining: core.remaining,
        resetAt: new Date(core.reset * 1000)
      };
    } catch {
      return null;
    }
  }
}

export function createGitHubAdapter(config: GitHubConfig): GitHubAdapter {
  return new GitHubAdapter(config);
}
