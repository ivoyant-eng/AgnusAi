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
import { getAzureOAuthToken } from './azure-oauth';

// Support comma-separated names: RYV_BOT_NAME=ryv,AI Agents,agnus
const RYV_BOT_NAMES: string[] = (process.env.RYV_BOT_NAME ?? 'ryv')
  .split(',')
  .map(n => n.trim())
  .filter(Boolean);
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
  vcsInstallationId?: string;
  /** Pre-resolved @mention alias to show in replies (e.g. "@AI Agents"). Overrides auto-extraction. */
  botMention?: string;
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
    token, vcsInstallationId, baseBranch, rawBody, pool, forceCommand, triggerReview,
  } = opts;
  // Use pre-resolved mention alias if passed from the webhook layer (avoids falling back to 'ryv')
  const resolvedBotMention = opts.botMention;

  const rateKey = `${repoId}:${prNumber}`;
  if (isRateLimited(rateKey)) {
    console.warn(`[command-runner] Rate limit exceeded for PR ${prNumber} — ignoring`);
    return;
  }

  // Extract query: strip the @<GUID> or @<botname> prefix
  let userQuery = rawBody;
  let botMention: string = resolvedBotMention ?? `@${RYV_BOT_NAMES[0] ?? 'ryv'}`;
  // Azure @<GUID> mention — strip GUID, use pre-resolved display name
  const guidMatch = /@<[0-9a-f-]{36}>/i.exec(rawBody);
  if (guidMatch) {
    userQuery = rawBody.slice(guidMatch.index + guidMatch[0].length).trim();
  } else {
    // GitHub / plain @name mention
    const matchedName = RYV_BOT_NAMES.find(n =>
      rawBody.toLowerCase().includes(`@${n.toLowerCase()}`)
    );
    if (matchedName) {
      if (!resolvedBotMention) botMention = `@${matchedName}`;
      const idx = rawBody.toLowerCase().indexOf(`@${matchedName.toLowerCase()}`);
      userQuery = rawBody.slice(idx + matchedName.length + 1).trim();
    }
  }

  // Build VCS adapter — prefer PAT, fall back to OAuth installation token
  let vcs: GitHubAdapter | AzureDevOpsAdapter;
  let effectiveToken = token;
  if (platform === 'github') {
    if (!effectiveToken) { console.warn('[command-runner] No GitHub token'); return; }
    const parts = repoUrl.replace(/\/$/, '').split('/');
    vcs = new GitHubAdapter({ token: effectiveToken, owner: parts[parts.length - 2] ?? '', repo: parts[parts.length - 1] ?? '' });
  } else {
    if (!effectiveToken && vcsInstallationId) {
      try {
        effectiveToken = await getAzureOAuthToken(pool, vcsInstallationId)
      } catch (err) {
        console.warn('[command-runner] OAuth token fetch failed:', (err as Error).message)
      }
    }
    if (!effectiveToken) { console.warn('[command-runner] No Azure token'); return; }
    const url = new URL(repoUrl);
    const p = url.pathname.split('/').filter(Boolean);
    vcs = new AzureDevOpsAdapter({ organization: p[0] ?? '', project: p[1] ?? '', repository: p[p.length - 1] ?? '', token: effectiveToken, authType: token ? 'pat' : 'bearer' });
  }

  const ctx: CommandContext = {
    platform, repoId, repoUrl, prNumber, commentId, threadId,
    token: effectiveToken, baseBranch, userQuery, rawMention: rawBody, botMention, pool,
  };

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
