// OpenAI LLM Backend — API call only

import fetch from 'node-fetch';
import { BaseLLMBackend } from './base';
import { ReviewContext } from '../types';

interface OpenAIConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
}

export class OpenAIBackend extends BaseLLMBackend {
  readonly name = 'openai';
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private baseUrl: string;

  constructor(config: OpenAIConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  }

  async generate(prompt: string, _context: ReviewContext): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0].message.content;
  }
}

export function createOpenAIBackend(config: OpenAIConfig): OpenAIBackend {
  return new OpenAIBackend(config);
}
