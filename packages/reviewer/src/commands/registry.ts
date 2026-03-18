import type { CommandDescriptor } from './types';
import { handleAsk } from './handlers/ask';
import { handleReview } from './handlers/review';
import { handleHelp } from './handlers/help';
import { handleFix } from './handlers/fix';
import { handleTest } from './handlers/test';
import { handlePRMeta } from './handlers/pr_meta';

const comingSoonHandler = (name: string) =>
  async (ctx: import('./types').CommandContext) => ({
    reply: `**${ctx.botMention ?? '@ryv'}** The \`${name}\` command is coming soon. Stay tuned!`,
  });

export const COMMAND_REGISTRY: CommandDescriptor[] = [
  {
    name: 'ask',
    description: 'Answer any question about the PR, diff, or codebase using graph context',
    examples: ['what does this do', 'explain the auth change', 'why is this needed'],
    handler: handleAsk,
  },
  {
    name: 'review',
    description: 'Trigger a fresh full review of the PR — re-runs the complete review pipeline and posts new findings',
    examples: ['re-review this PR', 'review again', 'run a new review'],
    handler: handleReview,
  },
  {
    name: 'fix',
    description: 'Autonomously fix a specific issue by opening a companion PR with the fix applied',
    examples: ['fix this', 'fix the null check', 'fix the bug on line 42', 'fix the hardcoded credentials', 'please fix and add proper JSDocs'],
    handler: handleFix,
  },
  {
    name: 'test',
    description: 'Generate unit tests for the changed code and open a companion PR',
    examples: ['generate tests', 'write unit tests', 'add test cases', 'create tests for this', 'test this function'],
    handler: handleTest,
  },
  {
    name: 'implement',
    description: 'Autonomously implement a described feature or change by opening a companion PR',
    examples: ['implement this feature', 'add pagination', 'implement the todo comment'],
    handler: comingSoonHandler('implement'),
    comingSoon: true,
  },
  {
    name: 'docs',
    description: 'Generate docstrings for changed functions and classes',
    examples: ['add docs', 'generate docstrings', 'document this'],
    handler: comingSoonHandler('docs'),
    comingSoon: true,
  },
  {
    name: 'changelog',
    description: 'Append an entry to CHANGELOG.md for this PR',
    examples: ['update changelog', 'add a changelog entry'],
    handler: comingSoonHandler('changelog'),
    comingSoon: true,
  },
  {
    name: 'ticket_create',
    description: 'Create a ticket in Jira / Linear / GitHub Issues from this PR',
    examples: ['create a ticket', 'open a Jira issue', 'log this as a Linear task'],
    handler: comingSoonHandler('ticket_create'),
    comingSoon: true,
  },
  {
    name: 'similar',
    description: 'Find semantically similar code in the codebase',
    examples: ['find similar code', 'are there similar implementations'],
    handler: comingSoonHandler('similar'),
    comingSoon: true,
  },
  {
    name: 'pr_meta',
    description: 'Write or update the PR title, description, and/or labels. Use "add" to append, "rephrase" to overwrite.',
    examples: [
      'write PR description',
      'add description',
      'rephrase description',
      'add title',
      'rephrase title',
      'add labels',
      'write PR description and title',
      'rephrase the PR description and title',
      'update the PR description',
      'set labels',
    ],
    handler: handlePRMeta,
  },
  {
    name: 'help',
    description: 'List all available commands with examples',
    examples: ['help', 'what can you do', 'list commands'],
    handler: handleHelp,
  },
];
