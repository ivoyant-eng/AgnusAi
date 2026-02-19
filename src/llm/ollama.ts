// Ollama LLM Backend — API call only

import fetch from 'node-fetch';
import { BaseLLMBackend } from './base';
import { ReviewContext } from '../types';

interface OllamaConfig {
  model: string;
  baseUrl?: string;
}

export class OllamaBackend extends BaseLLMBackend {
  readonly name = 'ollama';
  private model: string;
  private baseUrl: string;

  constructor(config: OllamaConfig) {
    super();
    this.model = config.model;
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async generate(prompt: string, _context: ReviewContext): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  }
}

export function createOllamaBackend(config: OllamaConfig): OllamaBackend {
  return new OllamaBackend(config);
}
