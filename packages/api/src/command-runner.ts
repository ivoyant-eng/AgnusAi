/**
 * command-runner.ts
 * Bridge between webhook payloads and the @ryv command dispatcher.
 * Handles rate limiting, VCS adapter construction, and async dispatch.
 */

import type { Pool } from 'pg';
import {
  GitHubAdapter,
  AzureDevOpsAdapter,
  createBackendFromEnv,
  dispatchCommand,
  COMMAND_REGISTRY,
} from '@agnus-ai/reviewer';
import type { CommandContext } from '@agnus-ai/reviewer';
import { getRepo } from './graph-cache';

const RYV_BOT_NAME = process.env.RYV_BOT_NAME ?? 'ryv';
const COMMAND_MAX_PER_HOUR = parseInt(process.env.COMMAND_MAX_PER_HOUR ?? '10', 10);

// ─── Rate limiter ─────────────────────────────────────────────────────────────

interface RateRecord { count: number; windowStart: number }
const rateMap = new Map<string, RateRecord>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const rec = rateMap.get(key);
  if (!rec || now - rec.windowStart > 3_600_000) {
    rateMap.set(key, { count: 1, windowStart: now });
    return false;
  }
  if (rec.count >= COMMAND_MAX_PER_HOUR) return true;
  rec.count++;
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RunCommandOptions {
  platform: 'github' | 'azure';
  repoId: string;
  repoUrl: string;
  prNumber: number;
  commentId: number;
  threadId?: number;
  token?: string;
  baseBranch: string;
  rawBody: string;
  pool: Pool;
  /** If set, skip NLP and route directly to this command */
  forceCommand?: string;
  /** Callback fired after the 'review' command acknowledgement to re-trigger the review pipeline */
  triggerReview?: () => Promise<void>;
}

export async function runCommand(opts: RunCommandOptions): Promise<void> {
  const {
    platform, repoId, repoUrl, prNumber, commentId, threadId,
    token, baseBranch, rawBody, pool, forceCommand, triggerReview,
  } = opts;

  const rateKey = `${repoId}:${prNumber}`;
  if (isRateLimited(rateKey)) {
    console.warn(`[command-runner] Rate limit exceeded for PR ${prNumber} — ignoring`);
    return;
  }

  // Extract query: text after @ryv, or legacy /ask body
  let userQuery = rawBody;
  if (rawBody.includes(`@${RYV_BOT_NAME}`)) {
    userQuery = rawBody.split(`@${RYV_BOT_NAME}`).slice(1).join('').trim();
  }

  const ctx: CommandContext = {
    platform, repoId, repoUrl, prNumber, commentId, threadId,
    token, baseBranch, userQuery, rawMention: rawBody, pool,
  };

  // Build VCS adapter
  let vcs: GitHubAdapter | AzureDevOpsAdapter;
  if (platform === 'github') {
    if (!token) { console.warn('[command-runner] No GitHub token'); return; }
    const parts = repoUrl.replace(/\/$/, '').split('/');
    vcs = new GitHubAdapter({ token, owner: parts[parts.length - 2] ?? '', repo: parts[parts.length - 1] ?? '' });
  } else {
    if (!token) { console.warn('[command-runner] No Azure token'); return; }
    const url = new URL(repoUrl);
    const p = url.pathname.split('/').filter(Boolean);
    vcs = new AzureDevOpsAdapter({ organization: p[0] ?? '', project: p[1] ?? '', repository: p[p.length - 1] ?? '', token });
  }

  const llm = createBackendFromEnv(process.env);

  // Graph cache entry if indexed
  const graphEntry = getRepo(repoId, baseBranch) ?? undefined;

  // Classify intent (or use forced command)
  const intent = forceCommand
    ? { command: forceCommand, query: userQuery, confidence: 1 }
    : await dispatchCommand(userQuery, llm);

  console.log(`[command-runner] PR #${prNumber} → command=${intent.command} confidence=${intent.confidence}`);

  // Find handler
  const descriptor = COMMAND_REGISTRY.find(c => c.name === intent.command)
    ?? COMMAND_REGISTRY.find(c => c.name === 'ask')!;

  const result = await descriptor.handler(ctx, intent, vcs, llm, graphEntry);

  // Post reply
  const replyBody = result.reply;
  try {
    if (platform === 'github') {
      await (vcs as GitHubAdapter).replyToComment(prNumber, commentId, replyBody);
    } else if (platform === 'azure' && threadId !== undefined) {
      await (vcs as AzureDevOpsAdapter).replyToThread(prNumber, threadId, replyBody);
    } else {
      await vcs.addComment(prNumber, { path: '', line: 0, body: replyBody, severity: 'info' });
    }
  } catch (err) {
    console.error('[command-runner] Failed to post reply:', (err as Error).message);
    return;
  }

  // Fire async re-review if the command was 'review'
  if (intent.command === 'review' && triggerReview) {
    setImmediate(() =>
      triggerReview().catch(err =>
        console.error('[command-runner] Re-review failed:', (err as Error).message)
      )
    );
  }
}
