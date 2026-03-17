import type { CommandContext, CommandHandler } from '../types';
import { buildAskPrompt } from '../../llm/prompt';
import type { ReviewContext } from '../../types';

export const handleAsk: CommandHandler = async (ctx, intent, vcs, llm, graphEntry) => {
  const question = ctx.userQuery || intent.query;

  // Fetch PR + diff + graph context in parallel
  const [pr, diff, files] = await Promise.all([
    vcs.getPR(ctx.prNumber),
    vcs.getDiff(ctx.prNumber),
    vcs.getFiles(ctx.prNumber),
  ]);

  // Graph context if the repo is indexed
  let graphContext = undefined;
  if (graphEntry) {
    try {
      const diffStr = diff.files
        .map(f => `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n` + f.hunks.map(h => h.content).join('\n'))
        .join('\n');
      graphContext = await graphEntry.retriever.getReviewContext(diffStr, ctx.repoId);
    } catch { /* no graph context */ }
  }

  // Fetch the conversation thread — comments posted before this trigger comment.
  // This gives the LLM the full back-and-forth context so "explain more" / "what about X"
  // follow-up questions are answered with awareness of what was already said.
  const threadHistory = await buildThreadHistory(vcs, ctx);

  const context: ReviewContext = {
    pr,
    diff,
    files,
    tickets: [],
    skills: [],
    config: { maxDiffSize: 30000, focusAreas: [], ignorePaths: [] },
    graphContext,
  };

  // Prepend thread history to the question so buildAskPrompt sees the full conversation.
  const questionWithThread = threadHistory
    ? `${threadHistory}\n## Current Question\n${question}`
    : question;

  const prompt = buildAskPrompt(questionWithThread, context);
  const answer = await llm.generate(prompt, context);

  return {
    reply: `**@ryv:** ${answer}`,
  };
};

/**
 * Fetches the conversation thread and formats it as a history block for the LLM.
 * Capped at the last 10 messages to avoid token bloat.
 *
 * Azure: calls `getThreadComments(prId, ctx.threadId)` which fetches only the specific
 * thread (using the `/threads/{threadId}` API). Individual comment IDs are real
 * per-comment IDs, so filtering `id < ctx.commentId` correctly narrows to prior messages.
 *
 * GitHub: issue_comments have no thread concept — all PR-level comments are flat.
 * `getThreadComments` returns all of them; we filter to `id < ctx.commentId`.
 *
 * Returns an empty string if the adapter does not implement `getThreadComments`, or
 * if this is the first message in the thread (no prior context exists).
 */
async function buildThreadHistory(vcs: Parameters<CommandHandler>[2], ctx: CommandContext): Promise<string> {
  if (!vcs.getThreadComments) return '';
  try {
    // Azure: pass threadId to get only comments in this thread.
    // GitHub: threadId is ignored — returns all PR-level comments (flat).
    const all = await vcs.getThreadComments(ctx.prNumber, ctx.threadId);

    const prior = all
      .filter(c => c.id < ctx.commentId) // only messages that came before the trigger
      .slice(-10);                         // last 10 — enough context without blowing the prompt

    if (prior.length === 0) return '';

    const lines = prior.map(c => `**${c.user.login}:** ${c.body.replace(/\n+/g, ' ').slice(0, 500)}`);
    return `## Conversation History\n${lines.join('\n\n')}\n`;
  } catch {
    return '';
  }
}
