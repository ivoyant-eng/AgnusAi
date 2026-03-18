import type { CommandHandler } from '../types';
import { COMMAND_REGISTRY } from '../registry';

export const handleHelp: CommandHandler = async (ctx) => {
  const name = ctx.botMention ?? '@ryv';
  const rows = COMMAND_REGISTRY.map(cmd => {
    const status = cmd.comingSoon ? ' _(coming soon)_' : '';
    return `| \`${name} ${cmd.examples[0]}\` | ${cmd.description}${status} |`;
  });

  const reply = [
    `**${name} commands** — write anything natural after \`${name}\` and I'll figure out what you want.`,
    '',
    '| Example | What it does |',
    '|---------|-------------|',
    ...rows,
  ].join('\n');

  return { reply };
};
