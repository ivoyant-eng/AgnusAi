import type { Pool } from 'pg';
import type { VCSAdapter } from '../adapters/vcs/base';
import type { LLMBackend } from '../llm/base';
import type { ReviewContext } from '../types';

export interface CommandContext {
  platform: 'github' | 'azure';
  repoId: string;
  repoUrl: string;
  prNumber: number;
  /** ID of the comment that triggered the mention */
  commentId: number;
  /** Azure only: thread to reply into */
  threadId?: number;
  token?: string;
  baseBranch: string;
  /** Text written after @ryv (trimmed) */
  userQuery: string;
  /** Full original comment body */
  rawMention: string;
  pool: Pool;
}

export interface CommandIntent {
  command: string;
  /** Refined query extracted by the classifier */
  query: string;
  confidence: number;
}

export interface CommandResult {
  /** Markdown to post as reply */
  reply: string;
}

export interface GraphCacheEntry {
  retriever: {
    getReviewContext(diffStr: string, repoId: string): Promise<import('@agnus-ai/shared').GraphReviewContext>;
  };
}

export type CommandHandler = (
  ctx: CommandContext,
  intent: CommandIntent,
  vcs: VCSAdapter,
  llm: LLMBackend,
  graphEntry?: GraphCacheEntry,
) => Promise<CommandResult>;

export interface CommandDescriptor {
  name: string;
  /** Shown to the NLP classifier — describes what this command does */
  description: string;
  /** Few-shot trigger phrases for the classifier */
  examples: string[];
  handler: CommandHandler;
  /** If true, the handler returns a "coming soon" stub */
  comingSoon?: boolean;
}
