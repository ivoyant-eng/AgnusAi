import type { CommandContext, CommandHandler } from '../types';
import { buildAskPrompt } from '../../llm/prompt';
import type { ReviewContext } from '../../types';

export const handleAsk: CommandHandler = async (ctx, intent, vcs, llm, graphEntry) => {
  const question = intent.query || ctx.userQuery;

  // Fetch PR + diff
  const pr = await vcs.getPR(ctx.prNumber);
  const diff = await vcs.getDiff(ctx.prNumber);
  const files = await vcs.getFiles(ctx.prNumber);

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

  const context: ReviewContext = {
    pr,
    diff,
    files,
    tickets: [],
    skills: [],
    config: { maxDiffSize: 30000, focusAreas: [], ignorePaths: [] },
    graphContext,
  };

  const prompt = buildAskPrompt(question, context);
  const answer = await llm.generate(prompt, context);

  return {
    reply: `**@ryv answer to:** *${question.slice(0, 200)}*\n\n${answer}`,
  };
};
