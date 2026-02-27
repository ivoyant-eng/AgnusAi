// Azure DevOps VCS Adapter

import fetch from 'node-fetch';
import { VCSAdapter } from './base';
import {
  PullRequest,
  Diff,
  FileInfo,
  ReviewComment,
  Review,
  Ticket,
  Author,
  FileDiff,
  DiffHunk,
  DetailedReviewComment,
  PRComment,
  ReviewCheckpoint
} from '../../types';

interface AzureDevOpsConfig {
  organization: string;
  project: string;
  repository: string;
  token: string;
  baseUrl?: string;
}

export class AzureDevOpsAdapter implements VCSAdapter {
  readonly name = 'azure-devops';
  private organization: string;
  private project: string;
  private repository: string;
  private token: string;
  private baseUrl: string;
  /** When set, getDiff compares latest iteration vs this iteration ID. 0 = full diff. */
  compareToIteration?: number;

  constructor(config: AzureDevOpsConfig) {
    this.organization = config.organization;
    this.project = config.project;
    this.repository = config.repository;
    this.token = config.token;
    this.baseUrl = config.baseUrl || 'https://dev.azure.com';
  }

  async getLatestIterationId(prId: string | number): Promise<number> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/iterations?api-version=7.0`
    );
    const response = await fetch(url, { headers: this.getAuthHeaders() });
    if (!response.ok) throw new Error(`Failed to fetch iterations: ${response.statusText}`);
    const data = await response.json() as { value: Array<{ id: number }> };
    return data.value[data.value.length - 1]?.id ?? 0;
  }

  private getAuthHeaders(): Record<string, string> {
    // Azure DevOps uses Basic auth with PAT (password is empty)
    const encoded = Buffer.from(`:${this.token}`).toString('base64');
    return {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/json'
    };
  }

  private getApiUrl(path: string): string {
    return `${this.baseUrl}/${this.organization}/${this.project}/_apis${path}`;
  }

  private getGitApiUrl(path: string): string {
    return `${this.baseUrl}/${this.organization}/${this.project}/_apis/git${path}`;
  }

  async getPR(prId: string | number): Promise<PullRequest> {
    const url = this.getGitApiUrl(`/repositories/${this.repository}/pullrequests/${prId}?api-version=7.0`);
    
    const response = await fetch(url, {
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PR: ${response.statusText}`);
    }

    const data = await response.json() as {
      pullRequestId: number;
      title: string;
      description: string;
      createdBy: { id: string; displayName: string; uniqueName: string };
      sourceRefName: string;
      targetRefName: string;
      url: string;
      creationDate: string;
    };

    return {
      id: String(data.pullRequestId),
      number: data.pullRequestId,
      title: data.title,
      description: data.description || '',
      author: {
        id: data.createdBy.id,
        username: data.createdBy.uniqueName,
        email: data.createdBy.uniqueName
      },
      sourceBranch: data.sourceRefName.replace('refs/heads/', ''),
      targetBranch: data.targetRefName.replace('refs/heads/', ''),
      url: data.url,
      createdAt: new Date(data.creationDate),
      updatedAt: new Date(data.creationDate)
    };
  }

  async getDiff(prId: string | number): Promise<Diff> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/iterations?api-version=7.0`
    );

    const response = await fetch(url, { headers: this.getAuthHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to fetch PR iterations: ${response.statusText}`);
    }

    const iterations = await response.json() as {
      value: Array<{
        id: number;
        sourceRefCommit?: { commitId: string };
        targetRefCommit?: { commitId: string };
        commonRefCommit?: { commitId: string };
      }>
    };

    const first = iterations.value[0];
    const latest = iterations.value[iterations.value.length - 1];
    const sourceCommit = latest?.sourceRefCommit?.commitId ?? '';
    // Use iteration 1's commonRefCommit as the merge base — stays stable across pushes
    const targetCommit = first?.commonRefCommit?.commitId
      ?? first?.targetRefCommit?.commitId
      ?? latest?.commonRefCommit?.commitId
      ?? '';

    // compareTo=0: full cumulative diff (PR created / manual trigger)
    // compareTo=N: only the delta between iteration N and latest
    const compareTo = this.compareToIteration ?? 0;
    const changesUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/iterations/${latest.id}/changes?$compareTo=${compareTo}&api-version=7.0`
    );

    const changesResponse = await fetch(changesUrl, { headers: this.getAuthHeaders() });
    if (!changesResponse.ok) {
      throw new Error(`Failed to fetch PR changes: ${changesResponse.statusText}`);
    }

    const changesData = await changesResponse.json() as {
      changeEntries: Array<{
        item: { path: string };
        changeType: 'add' | 'edit' | 'delete' | 'rename';
      }>
    };

    const files: FileDiff[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const change of changesData.changeEntries || []) {
      // Azure returns null path for some deleted/folder entries — skip them
      if (!change.item?.path) continue;
      const status = this.mapChangeType(change.changeType);
      const diffContent = await this.getFileDiff(change.item.path, sourceCommit, targetCommit, status);

      files.push({
        path: change.item.path,
        status,
        additions: diffContent.additions,
        deletions: diffContent.deletions,
        hunks: diffContent.hunks
      });

      totalAdditions += diffContent.additions;
      totalDeletions += diffContent.deletions;
    }

    return { files, additions: totalAdditions, deletions: totalDeletions, changedFiles: files.length };
  }

  private async getFileDiff(
    filePath: string,
    sourceCommit: string,
    targetCommit: string,
    status: FileDiff['status']
  ): Promise<{ additions: number; deletions: number; hunks: DiffHunk[] }> {
    const [oldContent, newContent] = await Promise.all([
      status !== 'added' && targetCommit ? this.fetchFileAtCommit(filePath, targetCommit) : Promise.resolve(''),
      status !== 'deleted' && sourceCommit ? this.fetchFileAtCommit(filePath, sourceCommit) : Promise.resolve('')
    ]);
    return this.computeFileDiff(oldContent, newContent);
  }

  private async fetchFileAtCommit(filePath: string, commitId: string): Promise<string> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/items?path=${encodeURIComponent(filePath)}&versionDescriptor[versionType]=commit&versionDescriptor[version]=${commitId}&api-version=7.0`
    );
    try {
      const response = await fetch(url, {
        headers: { ...this.getAuthHeaders(), 'Accept': 'application/octet-stream' }
      });
      if (!response.ok) return '';
      return await response.text();
    } catch {
      return '';
    }
  }

  private computeFileDiff(
    oldContent: string,
    newContent: string
  ): { additions: number; deletions: number; hunks: DiffHunk[] } {
    const oldLines = oldContent ? oldContent.split('\n') : [];
    const newLines = newContent ? newContent.split('\n') : [];

    if (oldLines.length === 0 && newLines.length === 0) {
      return { additions: 0, deletions: 0, hunks: [] };
    }

    const edits = this.myersDiff(oldLines, newLines);
    const additions = edits.filter(e => e.type === 'add').length;
    const deletions = edits.filter(e => e.type === 'remove').length;
    const hunks = this.buildHunks(edits, 3);

    return { additions, deletions, hunks };
  }

  /**
   * Myers diff algorithm (O(N·D) time, O(N) space) — same algorithm used by Git.
   * Line hashing speeds up equality checks. Falls back to full-replacement only
   * when the edit distance itself exceeds a safe trace-memory limit.
   */
  private myersDiff(
    oldLines: string[],
    newLines: string[]
  ): Array<{ type: 'equal' | 'add' | 'remove'; oldLine: number; newLine: number; content: string }> {
    const m = oldLines.length;
    const n = newLines.length;
    const max = m + n;
    if (max === 0) return [];

    // FNV-1a line hashing for fast equality checks
    const hash = (s: string): number => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
      return h >>> 0;
    };
    const oldH = oldLines.map(hash);
    const newH = newLines.map(hash);
    const eq = (oi: number, ni: number) => oldH[oi] === newH[ni] && oldLines[oi] === newLines[ni];

    // Myers forward pass — V[k+offset] = furthest x on diagonal k
    const offset = max;
    const V = new Int32Array(2 * max + 2).fill(-1);
    V[1 + offset] = 0;
    const trace: Int32Array[] = [];

    let found = false;
    for (let d = 0; d <= max && !found; d++) {
      // Safety: stop storing trace if edit distance is huge (degenerate diff)
      if (d > 8000) {
        return [
          ...oldLines.map((c, i) => ({ type: 'remove' as const, oldLine: i + 1, newLine: 0, content: c })),
          ...newLines.map((c, i) => ({ type: 'add' as const, oldLine: 0, newLine: i + 1, content: c })),
        ];
      }
      trace.push(new Int32Array(V));
      for (let k = -d; k <= d; k += 2) {
        const km1 = V[k - 1 + offset];
        const kp1 = V[k + 1 + offset];
        let x = (k === -d || (k !== d && km1 < kp1)) ? kp1 : km1 + 1;
        let y = x - k;
        while (x < m && y < n && eq(x, y)) { x++; y++; }
        V[k + offset] = x;
        if (x >= m && y >= n) { found = true; break; }
      }
    }

    // Backtrack through trace to reconstruct edit list
    type Edit = { type: 'equal' | 'add' | 'remove'; oldLine: number; newLine: number; content: string };
    const result: Edit[] = [];
    let x = m, y = n;
    for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
      const Vd = trace[d];
      const k = x - y;
      const km1 = Vd[k - 1 + offset];
      const kp1 = Vd[k + 1 + offset];
      const prevK = (k === -d || (k !== d && km1 < kp1)) ? k + 1 : k - 1;
      const prevX = Vd[prevK + offset];
      const prevY = prevX - prevK;
      // Unwind snake
      while (x > prevX && y > prevY) {
        x--; y--;
        result.unshift({ type: 'equal', oldLine: x + 1, newLine: y + 1, content: oldLines[x] });
      }
      if (d > 0) {
        if (x === prevX) {
          y--;
          result.unshift({ type: 'add', oldLine: 0, newLine: y + 1, content: newLines[y] });
        } else {
          x--;
          result.unshift({ type: 'remove', oldLine: x + 1, newLine: 0, content: oldLines[x] });
        }
      }
    }
    return result;
  }

  private buildHunks(
    edits: Array<{ type: 'equal' | 'add' | 'remove'; oldLine: number; newLine: number; content: string }>,
    context: number
  ): DiffHunk[] {
    const changedIdxs = edits.reduce<number[]>((acc, e, i) => {
      if (e.type !== 'equal') acc.push(i);
      return acc;
    }, []);

    if (changedIdxs.length === 0) return [];

    // Merge overlapping context windows into ranges
    const ranges: [number, number][] = [];
    for (const idx of changedIdxs) {
      const start = Math.max(0, idx - context);
      const end = Math.min(edits.length - 1, idx + context);
      if (ranges.length && ranges[ranges.length - 1][1] >= start - 1) {
        ranges[ranges.length - 1][1] = end;
      } else {
        ranges.push([start, end]);
      }
    }

    return ranges.map(([start, end]) => {
      const slice = edits.slice(start, end + 1);
      const oldStart = slice.find(e => e.oldLine > 0)?.oldLine ?? 1;
      const newStart = slice.find(e => e.newLine > 0)?.newLine ?? 1;
      const oldLineCount = slice.filter(e => e.type !== 'add').length;
      const newLineCount = slice.filter(e => e.type !== 'remove').length;
      const body = slice.map(e =>
        e.type === 'add' ? `+${e.content}` : e.type === 'remove' ? `-${e.content}` : ` ${e.content}`
      ).join('\n');

      return {
        oldStart,
        oldLines: oldLineCount,
        newStart,
        newLines: newLineCount,
        content: body
      };
    });
  }

  private mapChangeType(changeType: string): FileDiff['status'] {
    switch (changeType) {
      case 'add':
        return 'added';
      case 'edit':
        return 'modified';
      case 'delete':
        return 'deleted';
      case 'rename':
        return 'renamed';
      default:
        return 'modified';
    }
  }

  async getFiles(prId: string | number): Promise<FileInfo[]> {
    const diff = await this.getDiff(prId);
    return diff.files.map(f => ({
      path: f.path,
      language: this.detectLanguage(f.path)
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
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      css: 'css',
      scss: 'scss',
      html: 'html',
      sql: 'sql',
      sh: 'bash'
    };
    return langMap[ext] || 'text';
  }

  async addComment(prId: string | number, comment: ReviewComment): Promise<void> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        comments: [{
          parentCommentId: 0,
          content: comment.body,
          commentType: 'text'
        }],
        status: 'active'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to add comment: ${response.statusText}`);
    }
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

    // Azure DevOps requires filePath to start with /
    const filePath = path.startsWith('/') ? path : `/${path}`;

    // Fetch the latest iteration to get proper iteration context
    const iterationsUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/iterations?api-version=7.0`
    );
    const iterationsResponse = await fetch(iterationsUrl, { headers: this.getAuthHeaders() });
    
    let iterationId: number | undefined;
    if (iterationsResponse.ok) {
      const iterations = await iterationsResponse.json() as { value: Array<{ id: number }> };
      if (iterations.value && iterations.value.length > 0) {
        // Get the most recent iteration
        iterationId = iterations.value[iterations.value.length - 1].id;
      }
    }

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads?api-version=7.0`
    );

    // Build the thread context with iteration info
    const threadContext: any = {
      filePath,
      rightFileStart: { line, offset: 1 },
      rightFileEnd: { line, offset: 1 }
    };

    // Include iteration context for proper line positioning
    const requestBody: any = {
      comments: [{
        parentCommentId: 0,
        content: body,
        commentType: 'text'
      }],
      status: 'active',
      threadContext
    };

    if (iterationId !== undefined) {
      requestBody.iterationId = iterationId;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to add inline comment at ${filePath}:${line}: ${response.statusText} - ${errorText}`);
      throw new Error(`Failed to add inline comment: ${response.statusText}`);
    }
  }

  async submitReview(prId: string | number, review: Review): Promise<void> {
    // Post summary as a comment
    const summaryUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads?api-version=7.0`
    );

    const verdictEmoji = {
      approve: '✅',
      request_changes: '🔄',
      comment: '💬'
    };

    // Post all inline comments
    for (const comment of review.comments) {
      await this.addInlineComment(prId, comment.path, comment.line, comment.body, comment.severity);
    }

    // Post summary
    await fetch(summaryUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        comments: [{
          parentCommentId: 0,
          content: `${verdictEmoji[review.verdict]} **Review Summary**\n\n${review.summary}\n\n**Verdict:** ${review.verdict}`,
          commentType: 'text'
        }],
        status: 'active'
      })
    });

    // Set vote (approve/reject)
    const voteMap: Record<string, number> = {
      approve: 10,      // Approved
      request_changes: -5,  // Waiting for author
      comment: 0        // No vote
    };

    if (voteMap[review.verdict] !== 0) {
      const prUrl = this.getGitApiUrl(
        `/repositories/${this.repository}/pullrequests/${prId}?api-version=7.0`
      );

      await fetch(prUrl, {
        method: 'PATCH',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          vote: voteMap[review.verdict]
        })
      });
    }
  }

  async getLinkedTickets(prId: string | number): Promise<Ticket[]> {
    const pr = await this.getPR(prId);
    const tickets: Ticket[] = [];
    const text = `${pr.title} ${pr.description}`;

    // Parse ticket IDs from PR description
    // Jira: PROJ-123
    // Azure Boards: #123 or AB#123
    const patterns = [
      /\b([A-Z]+-\d+)\b/g,      // Jira
      /\bAB#(\d+)\b/g,          // Azure Boards
      /#(\d+)/g                  // Simple number
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        tickets.push({
          id: match.replace(/^(AB)?#/, ''),
          key: match,
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
    const branch = ref || 'main';
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/items?path=${path}&versionDescriptor[versionOptions]=0&versionDescriptor[versionType]=0&versionDescriptor[version]=${branch}&api-version=7.0`
    );

    const response = await fetch(url, {
      headers: { ...this.getAuthHeaders(), 'Accept': 'application/octet-stream' }
    });

    if (!response.ok) {
      return '';
    }

    return await response.text();
  }

  // ============================================
  // Extended Comment Methods (for deduplication)
  // ============================================

  /**
   * Get all review comments (threads in Azure DevOps)
   * Handles pagination to fetch ALL comments
   */
  async getReviewComments(prId: string | number): Promise<DetailedReviewComment[]> {
    const comments: DetailedReviewComment[] = [];
    let skip = 0;
    const top = 100;
    let hasMore = true;

    while (hasMore) {
      const url = this.getGitApiUrl(
        `/repositories/${this.repository}/pullrequests/${prId}/threads?$top=${top}&$skip=${skip}&api-version=7.0`
      );

      const response = await fetch(url, { headers: this.getAuthHeaders() });
      if (!response.ok) {
        throw new Error(`Failed to fetch threads: ${response.statusText}`);
      }

      const data = await response.json() as {
        value: Array<{
          id: number;
          threadContext?: {
            filePath?: string;
            rightFileStart?: { line: number; offset: number };
          };
          comments: Array<{
            id: number;
            content: string;
            author: { displayName: string; uniqueName: string };
            publishedDate: string;
            lastUpdatedDate: string;
            parentCommentId?: number;
          }>;
          status: string;
        }>;
      };

      for (const thread of data.value || []) {
        // Each thread can have multiple comments
        for (const comment of thread.comments || []) {
          // Normalize file path (remove leading /)
          const path = thread.threadContext?.filePath?.replace(/^\//, '') || '';
          const line = thread.threadContext?.rightFileStart?.line || null;
          
          comments.push({
            id: Number(`${thread.id}-${comment.id}`), // Composite ID
            body: comment.content || '',
            user: {
              login: comment.author.uniqueName,
              type: 'User'
            },
            path,
            line,
            inReplyToId: comment.parentCommentId ? Number(`${thread.id}-${comment.parentCommentId}`) : null,
            createdAt: comment.publishedDate,
            updatedAt: comment.lastUpdatedDate,
            htmlUrl: `${this.baseUrl}/${this.organization}/${this.project}/_git/${this.repository}/pullrequest/${prId}?discussionId=${thread.id}`
          });
        }
      }

      // Check if there are more results
      hasMore = (data.value?.length || 0) === top;
      skip += top;

      // Safety limit
      if (skip > 1000) {
        console.warn('Reached maximum threads fetching comments');
        break;
      }
    }

    return comments;
  }

  /**
   * Get PR-level comments
   */
  async getPRComments(prId: string | number): Promise<PRComment[]> {
    // In Azure DevOps, these are threads without file context
    const threads = await this.getReviewComments(prId);
    return threads
      .filter(t => !t.path) // No file context = PR-level comment
      .map(t => ({
        id: t.id,
        body: t.body,
        user: t.user,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt
      }));
  }

  /**
   * Update a review comment
   */
  async updateReviewComment(
    prId: string | number,
    commentId: string | number,
    body: string
  ): Promise<void> {
    // Parse composite ID (threadId-commentId)
    const [threadIdStr, ,] = String(commentId).split('-');
    const threadId = parseInt(threadIdStr, 10);

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}/comments?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        content: body
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to update comment: ${response.statusText}`);
    }
  }

  /**
   * Delete a review comment
   */
  async deleteReviewComment(
    prId: string | number,
    commentId: string | number
  ): Promise<void> {
    const [threadIdStr, commentIdStr] = String(commentId).split('-');
    const threadId = parseInt(threadIdStr, 10);
    const cId = parseInt(commentIdStr, 10);

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}/comments/${cId}?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to delete comment: ${response.statusText}`);
    }
  }

  // ============================================
  // Checkpoint Methods
  // ============================================

  /**
   * Find existing checkpoint comment
   */
  async findCheckpointComment(prId: string | number): Promise<PRComment | null> {
    const comments = await this.getPRComments(prId);
    
    const checkpointComments = comments.filter(c => 
      c.body.includes('AGNUSAI_CHECKPOINT') || c.body.includes('AgnusAI Review Checkpoint')
    );
    
    if (checkpointComments.length === 0) {
      return null;
    }
    
    return checkpointComments.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  /**
   * Create a checkpoint comment
   */
  async createCheckpointComment(
    prId: string | number,
    checkpoint: ReviewCheckpoint
  ): Promise<string> {
    const body = this.generateCheckpointBody(checkpoint);
    
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        comments: [{
          parentCommentId: 0,
          content: body,
          commentType: 'text'
        }],
        status: 'active'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create checkpoint: ${response.statusText}`);
    }

    const data = await response.json() as { id: number };
    return String(data.id);
  }

  /**
   * Update an existing checkpoint comment
   */
  async updateCheckpointComment(
    commentId: string | number,
    checkpoint: ReviewCheckpoint
  ): Promise<void> {
    const body = this.generateCheckpointBody(checkpoint);
    const threadId = String(commentId);

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/*/threads/${threadId}/comments?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        content: body
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to update checkpoint: ${response.statusText}`);
    }
  }

  /**
   * Generate checkpoint body
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

  // ============================================
  // PR State Methods
  // ============================================

  /**
   * Check if PR is a draft
   */
  async isDraft(prId: string | number): Promise<boolean> {
    const pr = await this.getPR(prId);
    return (pr as any).isDraft ?? false;
  }

  /**
   * Check if PR is merged
   */
  async isMerged(prId: string | number): Promise<boolean> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}?api-version=7.0`
    );

    const response = await fetch(url, { headers: this.getAuthHeaders() });
    const data = await response.json() as { status: string };
    
    return data.status === 'completed';
  }

  /**
   * Check if PR is closed
   */
  async isClosed(prId: string | number): Promise<boolean> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}?api-version=7.0`
    );

    const response = await fetch(url, { headers: this.getAuthHeaders() });
    const data = await response.json() as { status: string };
    
    return data.status === 'abandoned';
  }

  /**
   * Check if discussion is locked (not supported in Azure DevOps)
   */
  async isLocked(prId: string | number): Promise<boolean> {
    // Azure DevOps doesn't have a direct equivalent to GitHub's "locked" state
    return false;
  }

  /**
   * Get file renames in a PR
   */
  async getFileRenames(prId: string | number): Promise<Array<{ oldPath: string; newPath: string }>> {
    const diff = await this.getDiff(prId);
    
    return diff.files
      .filter(f => f.status === 'renamed' && f.oldPath)
      .map(f => ({
        oldPath: f.oldPath!,
        newPath: f.path
      }));
  }

  // ============================================
  // Rate Limiting
  // ============================================

  /**
   * Get rate limit status (Azure DevOps doesn't expose this directly)
   */
  async getRateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date } | null> {
    // Azure DevOps doesn't have a public rate limit API
    // Return null to indicate not applicable
    return null;
  }
}

export function createAzureDevOpsAdapter(config: AzureDevOpsConfig): AzureDevOpsAdapter {
  return new AzureDevOpsAdapter(config);
}