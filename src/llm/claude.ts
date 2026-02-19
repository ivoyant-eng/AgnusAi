// Claude LLM Backend — DEPRECATED
// This backend is deprecated. Use UnifiedLLMBackend from './unified' instead.
// Note: Claude is no longer directly supported. Use OpenAI or a custom endpoint
// that provides Claude via OpenAI-compatible API (e.g., OpenRouter, AWS Bedrock).

import fetch from 'node-fetch';
import { BaseLLMBackend } from './base';
import { ReviewContext } from '../types';

/**
 * @deprecated Use UnifiedLLMBackend from './unified' instead
 * Claude is no longer directly supported. Use OpenAI-compatible endpoints like OpenRouter.
 */
interface ClaudeConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

/**
 * @deprecated Use UnifiedLLMBackend from './unified' instead
 */
export class ClaudeBackend extends BaseLLMBackend {
  readonly name = 'claude';
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor(config: ClaudeConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 4096;
  }

  async generate(prompt: string, _context: ReviewContext): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    return data.content[0].text;
  }
}

/**
 * @deprecated Use createUnifiedBackend from './unified' instead
 */
export function createClaudeBackend(config: ClaudeConfig): ClaudeBackend {
  return new ClaudeBackend(config);
}
