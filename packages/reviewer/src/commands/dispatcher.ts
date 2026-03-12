import type { LLMBackend } from '../llm/base';
import type { ReviewContext } from '../types';
import type { CommandIntent } from './types';
import { COMMAND_REGISTRY } from './registry';

/**
 * Returns a minimal stub ReviewContext suitable for the NLP classifier call.
 * The classifier only needs the LLM backend — no real PR data is required.
 */
function classifierContext(): ReviewContext {
  return {
    pr: { id: '', number: 0, title: '', description: '', author: { id: '', username: '' }, sourceBranch: '', targetBranch: '', url: '', createdAt: new Date(), updatedAt: new Date() },
    diff: { files: [], additions: 0, deletions: 0, changedFiles: 0 },
    files: [],
    tickets: [],
    skills: [],
    config: { maxDiffSize: 1000, focusAreas: [], ignorePaths: [] },
  };
}

/**
 * Builds the LLM prompt that classifies a free-text user message into a CommandIntent.
 * Lists all registered commands with their descriptions and example phrases so the LLM
 * can pick the best match. The returned `query` field must preserve the full user request.
 */
function buildClassifierPrompt(userQuery: string): string {
  const commandList = COMMAND_REGISTRY.map(cmd =>
    `- ${cmd.name}: ${cmd.description}\n  Examples: ${cmd.examples.join('; ')}`
  ).join('\n');

  return [
    'You are an intent classifier for @ryv, an AI code reviewer bot.',
    'The user wrote "@ryv" in a PR comment. Identify their intent from the message.',
    '',
    'Available commands:',
    commandList,
    '',
    `User message: "${userQuery}"`,
    '',
    'Respond with ONLY valid JSON (no markdown, no explanation):',
    '{"command": "<name>", "query": "<full user request — preserve ALL requirements, do not shorten or drop any>", "confidence": <0.0-1.0>}',
    'If unsure, default to "ask".',
  ].join('\n');
}

/**
 * Classifies a free-text user query into a CommandIntent using a small LLM call.
 * Falls back to `ask` if classification fails or confidence is low.
 */
export async function dispatchCommand(userQuery: string, llm: LLMBackend): Promise<CommandIntent> {
  if (!userQuery.trim()) {
    return { command: 'help', query: '', confidence: 1 };
  }

  // Fast-path: exact slash-command aliases (e.g. /test, /docs)
  const slashMatch = userQuery.match(/^\/([a-z_]+)\s*(.*)/i);
  if (slashMatch) {
    const name = slashMatch[1].toLowerCase();
    const found = COMMAND_REGISTRY.find(c => c.name === name);
    if (found) return { command: found.name, query: slashMatch[2].trim(), confidence: 1 };
  }

  try {
    const prompt = buildClassifierPrompt(userQuery);
    const raw = await llm.generate(prompt, classifierContext());

    // Extract JSON — strip any markdown fences the LLM might add
    const jsonStr = raw.replace(/```(?:json)?/g, '').trim();
    const intent: CommandIntent = JSON.parse(jsonStr);

    if (!intent.command || typeof intent.confidence !== 'number') {
      throw new Error('Invalid intent shape');
    }

    // Verify command exists in registry
    const exists = COMMAND_REGISTRY.some(c => c.name === intent.command);
    if (!exists) {
      return { command: 'ask', query: userQuery, confidence: 0.5 };
    }

    // Low confidence → fall back to ask
    if (intent.confidence < 0.5) {
      return { command: 'ask', query: userQuery, confidence: intent.confidence };
    }

    return intent;
  } catch {
    return { command: 'ask', query: userQuery, confidence: 0.5 };
  }
}
