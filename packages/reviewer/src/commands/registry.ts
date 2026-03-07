import type { CommandDescriptor } from './types';
import { handleAsk } from './handlers/ask';
import { handleReview } from './handlers/review';
import { handleHelp } from './handlers/help';

const comingSoonHandler = (name: string) =>
  async () => ({ reply: `**@ryv** The \`${name}\` command is coming soon. Stay tuned!` });

export const COMMAND_REGISTRY: CommandDescriptor[] = [
  {
    name: 'ask',
    description: 'Answer any question about the PR, diff, or codebase using graph context',
    examples: ['what does this do', 'explain the auth change', 'why is this needed'],
    handler: handleAsk,
  },
  {
    name: 'review',
    description: 'Trigger a fresh full review of the PR',
    examples: ['re-review', 'review this again', 'check this'],
    handler: handleReview,
  },
  {
    name: 'test',
    description: 'Generate unit tests for the changed code',
    examples: ['generate tests', 'write unit tests', 'add test cases'],
    handler: comingSoonHandler('test'),
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
    name: 'help',
    description: 'List all available commands with examples',
    examples: ['help', 'what can you do', 'list commands'],
    handler: handleHelp,
  },
];
