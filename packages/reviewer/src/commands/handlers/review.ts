import type { CommandHandler } from '../types';

/**
 * Triggers a fresh full review of the PR.
 * Posts an immediate acknowledgement — the actual review is fired asynchronously
 * by the caller (command-runner.ts) via a triggerReview callback.
 */
export const handleReview: CommandHandler = async (_ctx, _intent, _vcs, _llm) => {
  return {
    reply: '**@ryv** Re-review triggered. Results will appear shortly.',
  };
};
