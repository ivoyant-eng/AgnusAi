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
  DiffHunk
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

  constructor(config: AzureDevOpsConfig) {
    this.organization = config.organization;
    this.project = config.project;
    this.repository = config.repository;
    this.token = config.token;
    this.baseUrl = config.baseUrl || 'https://dev.azure.com';
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

    const latest = iterations.value[iterations.value.length - 1];
    const sourceCommit = latest?.sourceRefCommit?.commitId ?? '';
    // commonRefCommit is the merge base — best "before" snapshot
    const targetCommit = latest?.commonRefCommit?.commitId
      ?? latest?.targetRefCommit?.commitId
      ?? '';

    const changesUrl = this.getGitApiUrl(
      `/repositories/${this.repository}/pullrequests/${prId}/iterations/${latest.id}/changes?api-version=7.0`
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

    const edits = this.lcsEdits(oldLines, newLines);
    const additions = edits.filter(e => e.type === 'add').length;
    const deletions = edits.filter(e => e.type === 'remove').length;
    const hunks = this.buildHunks(edits, 3);

    return { additions, deletions, hunks };
  }

  private lcsEdits(
    oldLines: string[],
    newLines: string[]
  ): Array<{ type: 'equal' | 'add' | 'remove'; oldLine: number; newLine: number; content: string }> {
    const m = oldLines.length;
    const n = newLines.length;

    // Avoid O(m*n) blowup on very large files — treat as full replacement
    if (m * n > 600_000) {
      return [
        ...oldLines.map((c, i) => ({ type: 'remove' as const, oldLine: i + 1, newLine: 0, content: c })),
        ...newLines.map((c, i) => ({ type: 'add' as const, oldLine: 0, newLine: i + 1, content: c }))
      ];
    }

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    const result: Array<{ type: 'equal' | 'add' | 'remove'; oldLine: number; newLine: number; content: string }> = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ type: 'equal', oldLine: i, newLine: j, content: oldLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: 'add', oldLine: 0, newLine: j, content: newLines[j - 1] });
        j--;
      } else {
        result.unshift({ type: 'remove', oldLine: i, newLine: 0, content: oldLines[i - 1] });
        i--;
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
        content: `@@ -${oldStart},${oldLineCount} +${newStart},${newLineCount} @@\n${body}`
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
        status: 'active',
        threadContext: {
          filePath,
          rightFileStart: { line, offset: 1 },
          rightFileEnd: { line, offset: 1 }
        }
      })
    });

    if (!response.ok) {
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
}

export function createAzureDevOpsAdapter(config: AzureDevOpsConfig): AzureDevOpsAdapter {
  return new AzureDevOpsAdapter(config);
}