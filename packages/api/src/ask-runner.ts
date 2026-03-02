/**
 * /ask command runner — answers a question about a PR using the diff + graph context.
 * Triggered by issue_comment or review comment events starting with "/ask ".
 */

import type { Pool } from 'pg';
import {
  GitHubAdapter,
  AzureDevOpsAdapter,
  createBackendFromEnv,
  buildAskPrompt,
} from '@agnus-ai/reviewer';
import type { ReviewContext } from '@agnus-ai/reviewer';
import { getRepo } from './graph-cache';

// Simple in-memory per-PR rate limiter: max 10 /ask calls per hour
interface AskRecord { count: number; windowStart: number }
const askRateMap = new Map<string, AskRecord>();
const ASK_MAX_PER_HOUR = 10;

function isRateLimited(prKey: string): boolean {
  const now = Date.now();
  const record = askRateMap.get(prKey);
  if (!record || now - record.windowStart > 3_600_000) {
    askRateMap.set(prKey, { count: 1, windowStart: now });
    return false;
  }
  if (record.count >= ASK_MAX_PER_HOUR) return true;
  record.count++;
  return false;
}

export interface AskRunOptions {
  platform: 'github' | 'azure';
  repoId: string;
  repoUrl: string;
  prNumber: number;
  question: string;
  commentId: number;
  threadId?: number;       // Azure: thread to reply to
  token?: string;
  baseBranch: string;
  pool: Pool;
}

export async function runAsk(opts: AskRunOptions): Promise<void> {
  const { platform, repoId, repoUrl, prNumber, question, commentId, threadId, token, baseBranch, pool } = opts;

  const prKey = `${repoId}:${prNumber}`;
  if (isRateLimited(prKey)) {
    console.warn(`[ask-runner] Rate limit exceeded for PR ${prNumber} — ignoring /ask`);
    return;
  }

  // 1. Build VCS adapter
  let vcs: GitHubAdapter | AzureDevOpsAdapter;
  if (platform === 'github') {
    if (!token) { console.warn('[ask-runner] No GitHub token'); return; }
    const parts = repoUrl.replace(/\/$/, '').split('/');
    const owner = parts[parts.length - 2] ?? '';
    const repo = parts[parts.length - 1] ?? '';
    vcs = new GitHubAdapter({ token, owner, repo });
  } else {
    if (!token) { console.warn('[ask-runner] No Azure token'); return; }
    const url = new URL(repoUrl);
    const p = url.pathname.split('/').filter(Boolean);
    vcs = new AzureDevOpsAdapter({
      organization: p[0] ?? '',
      project: p[1] ?? '',
      repository: p[p.length - 1] ?? '',
      token,
    });
  }

  // 2. Fetch PR + diff
  const pr = await vcs.getPR(prNumber);
  const diff = await vcs.getDiff(prNumber);
  const files = await vcs.getFiles(prNumber);

  // 3. Graph context if available
  let graphContext = undefined;
  const entry = getRepo(repoId, baseBranch);
  if (entry) {
    try {
      const diffStr = diff.files.map(f =>
        `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n` +
        f.hunks.map(h => h.content).join('\n')
      ).join('\n');
      graphContext = await entry.retriever.getReviewContext(diffStr, repoId);
    } catch { /* no graph context */ }
  }

  const context: ReviewContext = {
    pr,
    diff,
    files,
    tickets: [],
    skills: [],
    config: {
      maxDiffSize: 30000,
      focusAreas: [],
      ignorePaths: [],
    },
    graphContext,
  };

  // 4. Build prompt and call LLM
  const llm = createBackendFromEnv(process.env);
  const prompt = buildAskPrompt(question, context);
  let answer: string;
  try {
    answer = await llm.generate(prompt, context);
  } catch (err) {
    console.error('[ask-runner] LLM call failed:', (err as Error).message);
    return;
  }

  // 5. Post reply
  const replyBody = `**AgnusAI answer to:** *${question.slice(0, 200)}*\n\n${answer}`;
  try {
    if (platform === 'github') {
      await (vcs as GitHubAdapter).replyToComment(prNumber, commentId, replyBody);
    } else if (platform === 'azure' && threadId !== undefined) {
      await (vcs as AzureDevOpsAdapter).replyToThread(prNumber, threadId, replyBody);
    } else {
      await vcs.addComment(prNumber, { path: '', line: 0, body: replyBody, severity: 'info' });
    }
    console.log(`[ask-runner] Answered /ask on PR ${prNumber}`);
  } catch (err) {
    console.error('[ask-runner] Failed to post reply:', (err as Error).message);
  }
}
