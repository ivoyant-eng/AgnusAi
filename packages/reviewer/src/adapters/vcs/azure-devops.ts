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
  ReviewCheckpoint,
  PRDescriptionResult
} from '../../types';

/**
 * Azure DevOps does not render GitHub's ```suggestion``` fences as interactive
 * suggested changes — it treats the unknown language tag as a plain code block.
 * Replace each fence with a clearly-labelled fenced block so reviewers can
 * still read and apply the suggestion manually.
 */
function convertSuggestionBlocks(body: string): string {
  return body.replace(/```suggestion\r?\n([\s\S]*?)\n```/gi, (_, code) =>
    `**Suggested change:**\n\`\`\`\n${code}\n\`\`\``
  );
}

interface AzureDevOpsConfig {
  organization: string;
  project: string;
  repository: string;
  token: string;
  /** When 'bearer', uses OAuth access token (Authorization: Bearer). Default is PAT basic auth. */
  authType?: 'pat' | 'bearer';
  baseUrl?: string;
}

export class AzureDevOpsAdapter implements VCSAdapter {
  readonly name = 'azure-devops';
  private organization: string;
  private project: string;
  private repository: string;
  private token: string;
  private authType: 'pat' | 'bearer';
  private baseUrl: string;
  /** When set, getDiff compares latest iteration vs this iteration ID. 0 = full diff. */
  compareToIteration?: number;

  /**
   * Tracks the active PR id across checkpoint update/delete calls.
   *
   * Azure requires the PR id in every thread/comment URL, but the VCSAdapter interface's
   * updateCheckpointComment and deleteCheckpointComment signatures omit it (matching GitHub's
   * issue-comment model where comment IDs are globally unique). We capture it whenever a
   * PR-scoped method is called so downstream checkpoint helpers have access.
   *
   * Note: for Azure, incremental review is handled via iteration-based DB state
   * (pr_review_state table), not PR checkpoint comments. These methods are implemented
   * for interface completeness but are not invoked by the Azure review flow.
   */
  private _activePrId: string | number | null = null;

  constructor(config: AzureDevOpsConfig) {
    this.organization = config.organization;
    this.project = config.project;
    this.repository = config.repository;
    this.token = config.token;
    this.authType = config.authType ?? 'pat';
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
    const authHeader = this.authType === 'bearer'
      ? `Bearer ${this.token}`
      : `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`;
    return { 'Authorization': authHeader, 'Content-Type': 'application/json' };
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

    // For incremental reviews: use the previous iteration's source commit as the "old" side
    // of each file diff. Without this, getFileDiff always compares against the original PR
    // base (targetCommit), producing a cumulative diff that causes the LLM to re-comment on
    // code already reviewed in earlier iterations.
    const prevIteration = compareTo > 0
      ? iterations.value.find(it => it.id === compareTo)
      : undefined;
    const effectiveOldCommit = prevIteration?.sourceRefCommit?.commitId ?? targetCommit;

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
      const diffContent = await this.getFileDiff(change.item.path, sourceCommit, effectiveOldCommit, status);

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
    _severity: 'info' | 'warning' | 'error' = 'info'
  ): Promise<void> {
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
        content: convertSuggestionBlocks(body),
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
    const summaryUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads?api-version=7.0`
    );

    const verdictEmoji = {
      approve: '✅',
      request_changes: '🔄',
      comment: '💬'
    };

    // Build a map of existing AgnusAI threads: "path:line" → { threadId, commentId }
    // so we can UPDATE instead of creating duplicate threads on the same line.
    const existingMap = await this.getAgnusThreadMap(prId);

    // Post or update inline comments
    for (const comment of review.comments) {
      const filePath = comment.path.startsWith('/') ? comment.path : `/${comment.path}`;
      const key = `${filePath}:${comment.line}`;
      const existing = existingMap.get(key);

      if (existing) {
        // Update the existing thread's comment with the new finding
        console.log(`[azure-adapter] Updating existing thread ${existing.threadId} at ${key}`);
        await this.updateThreadComment(prId, existing.threadId, existing.commentId, comment.body);
      } else {
        await this.addInlineComment(prId, comment.path, comment.line, comment.body, comment.severity);
      }
    }

    // Post summary
    await fetch(summaryUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        comments: [{
          parentCommentId: 0,
          content: review.summary,
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

  /**
   * Fetch existing AgnusAI inline threads and return a map of "filePath:line" → { threadId, commentId }.
   * Identifies our threads by the "Was this helpful?" feedback link pattern.
   */
  private async getAgnusThreadMap(prId: string | number): Promise<Map<string, { threadId: number; commentId: number }>> {
    const map = new Map<string, { threadId: number; commentId: number }>();
    try {
      const url = this.getGitApiUrl(
        `/repositories/${this.repository}/pullrequests/${prId}/threads?api-version=7.0`
      );
      const response = await fetch(url, { headers: this.getAuthHeaders() });
      if (!response.ok) return map;

      const data = await response.json() as {
        value: Array<{
          id: number;
          threadContext?: { filePath?: string; rightFileStart?: { line: number } };
          comments: Array<{ id: number; content: string }>;
          isDeleted?: boolean;
        }>;
      };

      for (const thread of data.value || []) {
        if (thread.isDeleted) continue;
        const ctx = thread.threadContext;
        if (!ctx?.filePath || !ctx.rightFileStart?.line) continue;

        // Check if the first comment looks like an AgnusAI comment
        const firstComment = thread.comments?.[0];
        if (!firstComment) continue;
        const body = firstComment.content || '';
        if (!body.includes('Was this helpful?') && !body.includes('**Suggestion:**')) continue;

        const key = `${ctx.filePath}:${ctx.rightFileStart.line}`;
        // Keep the most recent thread if multiple exist on the same line
        map.set(key, { threadId: thread.id, commentId: firstComment.id });
      }
    } catch (err) {
      console.warn('[azure-adapter] Failed to fetch existing threads for dedup:', (err as Error).message);
    }
    return map;
  }

  /**
   * Update an existing thread comment's body (PATCH).
   */
  private async updateThreadComment(
    prId: string | number,
    threadId: number,
    commentId: number,
    newBody: string
  ): Promise<void> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}/comments/${commentId}?api-version=7.0`
    );
    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ content: convertSuggestionBlocks(newBody) })
    });
    if (!response.ok) {
      console.error(`[azure-adapter] Failed to update thread ${threadId} comment ${commentId}: ${response.statusText}`);
      // Fallback: don't throw — we'll just have a duplicate, which is better than crashing the review
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

  async updatePRDescription(prId: string | number, description: PRDescriptionResult): Promise<void> {
    const prUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}?api-version=7.0`
    );

    const response = await fetch(prUrl, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        title: description.title,
        description: description.body,
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to update PR description: ${response.statusText}`);
    }

    const desiredLabels = new Set<string>([
      `type:${description.changeType}`,
      ...description.labels.map(l => l.trim()).filter(Boolean)
    ]);

    if (desiredLabels.size === 0) {
      return;
    }

    const existingLabels = await this.getPRLabels(prId);
    for (const label of desiredLabels) {
      if (existingLabels.has(label.toLowerCase())) continue;
      await this.addPRLabel(prId, label);
    }
  }

  private async getPRLabels(prId: string | number): Promise<Set<string>> {
    const versions = ['7.1', '7.1-preview.1'];
    for (const version of versions) {
      const url = this.getGitApiUrl(
        `/repositories/${this.repository}/pullrequests/${prId}/labels?api-version=${version}`
      );
      const response = await fetch(url, { headers: this.getAuthHeaders() });
      if (!response.ok) continue;

      const data = await response.json() as { value?: Array<{ name?: string }> };
      const labels = new Set<string>();
      for (const entry of data.value || []) {
        if (entry.name) labels.add(entry.name.toLowerCase());
      }
      return labels;
    }
    return new Set<string>();
  }

  private async addPRLabel(prId: string | number, label: string): Promise<void> {
    const versions = ['7.1', '7.1-preview.1'];
    let lastStatus = '';

    for (const version of versions) {
      const url = this.getGitApiUrl(
        `/repositories/${this.repository}/pullrequests/${prId}/labels?api-version=${version}`
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ name: label })
      });

      if (response.ok || response.status === 409) {
        return;
      }

      lastStatus = response.statusText;
    }

    throw new Error(`Failed to add PR label "${label}": ${lastStatus || 'unknown error'}`);
  }

  /**
   * Reply to an existing PR thread by posting a new comment in it.
   */
  async replyToThread(prId: string | number, threadId: number, body: string): Promise<void> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}/comments?api-version=7.0`,
    );
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ content: body, commentType: 1 }),
    });
    if (!response.ok) {
      throw new Error(`Failed to reply to thread ${threadId}: ${response.statusText}`);
    }
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
   * Get all review comments (threads) on a PR.
   *
   * Azure DevOps models review discussions as "threads" where each thread is anchored
   * to a file+line position. AgnusAI creates one-comment threads (one finding per thread),
   * so the thread ID is the natural stable identifier for a comment. We use thread.id
   * directly as the DetailedReviewComment.id — this ensures updateReviewComment and
   * deleteReviewComment can address the correct thread without NaN-producing composite math.
   *
   * Replies (parentCommentId > 0) within a thread are also surfaced so callers can see
   * the full conversation, though AgnusAI only writes to / edits the first (root) comment.
   *
   * Handles pagination: fetches up to 1000 threads (well beyond normal PR sizes).
   */
  async getReviewComments(prId: string | number): Promise<DetailedReviewComment[]> {
    this._activePrId = prId;
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
          isDeleted?: boolean;
          status: string;
        }>;
      };

      for (const thread of data.value || []) {
        if (thread.isDeleted) continue;

        // Normalize file path: Azure stores paths with a leading "/", consumers expect without
        const filePath = thread.threadContext?.filePath?.replace(/^\//, '') || '';
        const line = thread.threadContext?.rightFileStart?.line || null;

        for (const comment of thread.comments || []) {
          comments.push({
            // Use thread.id as the stable comment identifier. Azure threads are
            // 1:1 with AgnusAI findings. We intentionally ignore the per-thread
            // comment sequence number here to avoid the NaN issue with Number("x-y").
            id: thread.id,
            body: comment.content || '',
            user: {
              login: comment.author.uniqueName,
              type: 'User'
            },
            path: filePath,
            line,
            // Replies reference the root comment by parentCommentId; map back to thread id
            inReplyToId: comment.parentCommentId ? thread.id : null,
            createdAt: comment.publishedDate,
            updatedAt: comment.lastUpdatedDate,
            htmlUrl: `${this.baseUrl}/${this.organization}/${this.project}/_git/${this.repository}/pullrequest/${prId}?discussionId=${thread.id}`
          });
        }
      }

      hasMore = (data.value?.length || 0) === top;
      skip += top;

      if (skip > 1000) {
        console.warn('[azure-adapter] Reached 1000-thread safety limit while fetching comments');
        break;
      }
    }

    return comments;
  }

  /**
   * Get PR-level comments (threads with no file context).
   *
   * In Azure DevOps, PR-level comments (e.g. the summary, checkpoint comment) are threads
   * that have no threadContext.filePath. We return thread.id as the PRComment.id so callers
   * can pass it back to updateCheckpointComment / deleteCheckpointComment.
   */
  async getPRComments(prId: string | number): Promise<PRComment[]> {
    this._activePrId = prId;
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads?api-version=7.0`
    );
    const response = await fetch(url, { headers: this.getAuthHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to fetch PR threads: ${response.statusText}`);
    }
    const data = await response.json() as {
      value: Array<{
        id: number;
        threadContext?: { filePath?: string };
        comments: Array<{
          id: number;
          content: string;
          author: { displayName: string; uniqueName: string };
          publishedDate: string;
          lastUpdatedDate: string;
        }>;
        isDeleted?: boolean;
      }>;
    };

    const prComments: PRComment[] = [];
    for (const thread of data.value || []) {
      if (thread.isDeleted) continue;
      // PR-level threads have no file context
      if (thread.threadContext?.filePath) continue;
      const firstComment = thread.comments?.[0];
      if (!firstComment) continue;
      prComments.push({
        id: thread.id,  // thread id is the stable identifier for checkpoint operations
        body: firstComment.content || '',
        user: {
          login: firstComment.author.uniqueName,
          type: 'User'
        },
        createdAt: firstComment.publishedDate,
        updatedAt: firstComment.lastUpdatedDate,
      });
    }
    return prComments;
  }

  /**
   * Update a review comment.
   *
   * commentId is the thread id (as returned by getReviewComments). AgnusAI always writes
   * its finding as the first comment in the thread (comment sequence id = 1), so we target
   * that specific comment. The PATCH must include the comment sequence id in the URL —
   * omitting it previously caused a 404 or silently patched nothing.
   */
  async updateReviewComment(
    prId: string | number,
    commentId: string | number,
    body: string
  ): Promise<void> {
    // commentId is the thread id. The root comment within that thread has sequence id 1.
    const threadId = parseInt(String(commentId), 10);
    const rootCommentId = 1; // AgnusAI's inline comments are always the first in their thread

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}/comments/${rootCommentId}?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ content: body })
    });

    if (!response.ok) {
      throw new Error(`Failed to update comment in thread ${threadId}: ${response.statusText}`);
    }
  }

  /**
   * Delete a review comment.
   *
   * commentId is the thread id. We delete comment sequence 1 (the root comment AgnusAI
   * wrote). Azure DevOps prevents deletion of the only comment in a thread via the REST
   * API, so we fall back to closing the thread (status = "closed") when DELETE returns 403.
   * Closed threads are hidden from the PR UI by default.
   */
  async deleteReviewComment(
    prId: string | number,
    commentId: string | number
  ): Promise<void> {
    const threadId = parseInt(String(commentId), 10);
    const rootCommentId = 1;

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}/comments/${rootCommentId}?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });

    if (response.ok || response.status === 204) return;

    // Azure returns 403 when the comment is the sole comment in a thread (can't delete it).
    // Closing the thread achieves the same visual effect in the PR UI.
    if (response.status === 403 || response.status === 405) {
      await this.closeThread(prId, threadId);
      return;
    }

    throw new Error(`Failed to delete comment in thread ${threadId}: ${response.statusText}`);
  }

  /**
   * Close a thread (mark status = "closed").
   * Used as a fallback when a single-comment thread cannot be deleted via the REST API.
   */
  private async closeThread(prId: string | number, threadId: number): Promise<void> {
    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}?api-version=7.0`
    );
    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ status: 'closed' })
    });
    if (!response.ok) {
      console.error(`[azure-adapter] Failed to close thread ${threadId}: ${response.statusText}`);
    }
  }

  /**
   * Create a reply to an existing review comment thread.
   *
   * commentId is the thread id. Azure DevOps threads are the unit of conversation;
   * a reply is a new comment within that thread with parentCommentId pointing to
   * the root comment (sequence id 1).
   */
  async createReply(
    prId: string | number,
    commentId: string | number,
    body: string
  ): Promise<void> {
    const threadId = parseInt(String(commentId), 10);

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}/comments?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        parentCommentId: 1, // reply to the root comment
        content: body,
        commentType: 'text'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create reply in thread ${threadId}: ${response.statusText}`);
    }
  }

  /**
   * Get a single review comment by thread id.
   *
   * Returns the first (root) comment of the thread. commentId is the thread id,
   * consistent with the id values returned by getReviewComments.
   */
  async getReviewComment(commentId: string | number): Promise<DetailedReviewComment> {
    if (!this._activePrId) {
      throw new Error('[azure-adapter] getReviewComment called before a PR-scoped method set _activePrId');
    }
    const threadId = parseInt(String(commentId), 10);
    const prId = this._activePrId;

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}?api-version=7.0`
    );

    const response = await fetch(url, { headers: this.getAuthHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to fetch thread ${threadId}: ${response.statusText}`);
    }

    const thread = await response.json() as {
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
      }>;
    };

    const rootComment = thread.comments?.[0];
    if (!rootComment) {
      throw new Error(`Thread ${threadId} has no comments`);
    }

    const filePath = thread.threadContext?.filePath?.replace(/^\//, '') || '';
    const line = thread.threadContext?.rightFileStart?.line || null;

    return {
      id: thread.id,
      body: rootComment.content || '',
      user: {
        login: rootComment.author.uniqueName,
        type: 'User'
      },
      path: filePath,
      line,
      inReplyToId: null,
      createdAt: rootComment.publishedDate,
      updatedAt: rootComment.lastUpdatedDate,
      htmlUrl: `${this.baseUrl}/${this.organization}/${this.project}/_git/${this.repository}/pullrequest/${prId}?discussionId=${thread.id}`
    };
  }

  // ============================================
  // Checkpoint Methods
  // ============================================

  /**
   * Find an existing AgnusAI checkpoint comment.
   *
   * Checkpoint comments are PR-level threads (no file context) whose body contains the
   * AGNUSAI_CHECKPOINT marker. The returned PRComment.id is the thread id — pass it back
   * to updateCheckpointComment or deleteCheckpointComment.
   *
   * Note: Azure uses iteration-based incremental review (pr_review_state table), so this
   * method is implemented for interface completeness but not called by the normal flow.
   */
  async findCheckpointComment(prId: string | number): Promise<PRComment | null> {
    this._activePrId = prId;
    const comments = await this.getPRComments(prId);

    const checkpoints = comments.filter(c =>
      c.body.includes('AGNUSAI_CHECKPOINT') || c.body.includes('AgnusAI Review Checkpoint')
    );

    if (checkpoints.length === 0) return null;

    // Return the most recently created checkpoint (newest by creation date)
    return checkpoints.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  /**
   * Create a checkpoint comment (PR-level thread).
   *
   * Returns the thread id as a string. Stores the prId in _activePrId so that
   * updateCheckpointComment and deleteCheckpointComment can build the correct URL.
   *
   * Note: Azure uses iteration-based incremental review, so this is for completeness.
   */
  async createCheckpointComment(
    prId: string | number,
    checkpoint: ReviewCheckpoint
  ): Promise<string> {
    this._activePrId = prId;
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
      throw new Error(`Failed to create checkpoint thread: ${response.statusText}`);
    }

    const data = await response.json() as { id: number };
    return String(data.id);
  }

  /**
   * Update an existing checkpoint comment.
   *
   * commentId is the thread id (returned by createCheckpointComment / findCheckpointComment).
   * The checkpoint is always the root comment in the thread (sequence id = 1).
   *
   * Requires _activePrId to be set — it is captured by createCheckpointComment,
   * findCheckpointComment, and other PR-scoped methods on this adapter instance.
   */
  async updateCheckpointComment(
    commentId: string | number,
    checkpoint: ReviewCheckpoint
  ): Promise<void> {
    if (!this._activePrId) {
      throw new Error('[azure-adapter] updateCheckpointComment: no active prId (call findCheckpointComment first)');
    }
    const threadId = parseInt(String(commentId), 10);
    const rootCommentId = 1; // checkpoint is always the first comment in the thread

    const url = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${this._activePrId}/threads/${threadId}/comments/${rootCommentId}?api-version=7.0`
    );

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ content: this.generateCheckpointBody(checkpoint) })
    });

    if (!response.ok) {
      throw new Error(`Failed to update checkpoint thread ${threadId}: ${response.statusText}`);
    }
  }

  /**
   * Delete a checkpoint comment (close the PR-level thread).
   *
   * commentId is the thread id. Azure DevOps does not expose a thread-delete endpoint;
   * we instead close the thread, which hides it from the PR UI. The first comment (root)
   * is also deleted when the thread contains only one comment and the API allows it.
   *
   * Requires _activePrId to be set by a prior PR-scoped call on this adapter instance.
   */
  async deleteCheckpointComment(commentId: string | number): Promise<void> {
    if (!this._activePrId) {
      throw new Error('[azure-adapter] deleteCheckpointComment: no active prId (call findCheckpointComment first)');
    }
    const threadId = parseInt(String(commentId), 10);
    const prId = this._activePrId;

    // Try deleting comment 1 first; if Azure refuses (solo comment), close the thread instead
    const deleteUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/threads/${threadId}/comments/1?api-version=7.0`
    );
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });

    if (deleteResponse.ok || deleteResponse.status === 204) return;

    // Fallback: close the thread so it no longer appears in the PR timeline
    await this.closeThread(prId, threadId);
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
   * Check if discussion is locked.
   * Azure DevOps has no equivalent to GitHub's locked discussion state.
   */
  async isLocked(_prId: string | number): Promise<boolean> {
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

  // ============================================
  // Agentic Write Operations
  // ============================================

  /**
   * Create a new branch from an existing branch.
   * Uses the Azure DevOps Git Refs API.
   */
  async createBranch(branchName: string, fromBranch: string): Promise<void> {
    // 1. Get the current SHA of fromBranch
    const refsUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/refs?filter=heads/${encodeURIComponent(fromBranch)}&api-version=7.0`
    );
    const refsResponse = await fetch(refsUrl, { headers: this.getAuthHeaders() });
    if (!refsResponse.ok) {
      throw new Error(`Failed to get ref for branch '${fromBranch}': ${refsResponse.statusText}`);
    }
    const refsData = await refsResponse.json() as { value: Array<{ objectId: string }> };
    const sha = refsData.value[0]?.objectId;
    if (!sha) {
      throw new Error(`Branch '${fromBranch}' not found`);
    }

    // 2. Create the new branch ref
    const createUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/refs?api-version=7.0`
    );
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify([{
        name: `refs/heads/${branchName}`,
        newObjectId: sha,
        oldObjectId: '0000000000000000000000000000000000000000',
      }]),
    });
    if (!createResponse.ok) {
      throw new Error(`Failed to create branch '${branchName}': ${createResponse.statusText}`);
    }
    // Azure DevOps refs API returns HTTP 200 even for individual failures (e.g., branch already exists).
    // Check the updateStatus of each ref in the response body.
    const createData = await createResponse.json() as { value: Array<{ updateStatus: string; success: boolean }> };
    const refResult = createData.value?.[0];
    if (refResult && !refResult.success && refResult.updateStatus !== 'succeeded') {
      throw new Error(`Failed to create branch '${branchName}': ${refResult.updateStatus}`);
    }
  }

  /**
   * Commit one or more files to a branch via a single push.
   * Returns the new commit SHA.
   */
  async commitFiles(branch: string, files: Array<{ path: string; content: string }>, message: string): Promise<string> {
    // Get the current HEAD SHA of the branch to use as the old commit
    const refsUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/refs?filter=heads/${encodeURIComponent(branch)}&api-version=7.0`
    );
    const refsResponse = await fetch(refsUrl, { headers: this.getAuthHeaders() });
    if (!refsResponse.ok) {
      throw new Error(`Failed to get ref for branch '${branch}': ${refsResponse.statusText}`);
    }
    const refsData = await refsResponse.json() as { value: Array<{ objectId: string }> };
    const oldObjectId = refsData.value[0]?.objectId;
    if (!oldObjectId) {
      throw new Error(`Branch '${branch}' not found`);
    }

    const pushUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pushes?api-version=7.0`
    );
    const pushPayload = {
      refUpdates: [{ name: `refs/heads/${branch}`, oldObjectId }],
      commits: [{
        comment: message,
        changes: files.map(file => ({
          changeType: 'edit',
          item: { path: `/${file.path.replace(/^\//, '')}` },
          newContent: {
            content: Buffer.from(file.content).toString('base64'),
            contentType: 'base64encoded',
          },
        })),
      }],
    };

    const pushResponse = await fetch(pushUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(pushPayload),
    });
    if (!pushResponse.ok) {
      const errText = await pushResponse.text();
      throw new Error(`Failed to push files to '${branch}': ${pushResponse.statusText} — ${errText}`);
    }
    const pushData = await pushResponse.json() as { commits: Array<{ commitId: string }> };
    return pushData.commits[0]?.commitId ?? '';
  }

  /**
   * Open a pull request. Returns the PR URL and number.
   */
  async openPR(opts: { title: string; body: string; head: string; base: string }): Promise<{ url: string; number: number }> {
    const prUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests?api-version=7.0`
    );
    const prResponse = await fetch(prUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        title: opts.title,
        description: opts.body,
        sourceRefName: `refs/heads/${opts.head}`,
        targetRefName: `refs/heads/${opts.base}`,
      }),
    });
    if (!prResponse.ok) {
      const errText = await prResponse.text();
      throw new Error(`Failed to create PR: ${prResponse.statusText} — ${errText}`);
    }
    const prData = await prResponse.json() as { pullRequestId: number; url: string };
    const webUrl = `${this.baseUrl}/${this.organization}/${this.project}/_git/${this.repository}/pullrequest/${prData.pullRequestId}`;
    return { url: webUrl, number: prData.pullRequestId };
  }
}

export function createAzureDevOpsAdapter(config: AzureDevOpsConfig): AzureDevOpsAdapter {
  return new AzureDevOpsAdapter(config);
}
