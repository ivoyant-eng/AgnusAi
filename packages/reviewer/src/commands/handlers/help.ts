import type { CommandHandler } from '../types';
import { COMMAND_REGISTRY } from '../registry';

export const handleHelp: CommandHandler = async () => {
  const rows = COMMAND_REGISTRY.map(cmd => {
    const status = cmd.comingSoon ? ' _(coming soon)_' : '';
    return `| \`@ryv ${cmd.examples[0]}\` | ${cmd.description}${status} |`;
  });

  const reply = [
    '**@ryv commands** — write anything natural after `@ryv` and I\'ll figure out what you want.',
    '',
    '| Example | What it does |',
    '|---------|-------------|',
    ...rows,
  ].join('\n');

  return { reply };
};
