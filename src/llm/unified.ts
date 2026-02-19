// Unified LLM Backend using Vercel AI SDK's OpenAI-compatible provider
// Supports: Ollama, OpenAI, Azure OpenAI, and any OpenAI-compatible endpoint

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { BaseLLMBackend } from './base';
import { ReviewContext } from '../types';

// Provider presets with their default configurations
export const PROVIDER_PRESETS = {
  ollama: {
    name: 'ollama',
    baseURL: 'http://localhost:11434/v1',
  },
  openai: {
    name: 'openai',
    baseURL: 'https://api.openai.com/v1',
  },
  azure: {
    name: 'azure',
    baseURL: '', // Must be provided by user
  },
  custom: {
    name: 'custom',
    baseURL: '', // Must be provided by user
  },
} as const;

export type ProviderName = keyof typeof PROVIDER_PRESETS;

export interface UnifiedLLMConfig {
  provider: ProviderName;
  model: string;
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export class UnifiedLLMBackend extends BaseLLMBackend {
  readonly name: string;
  private provider: ReturnType<typeof createOpenAICompatible>;
  private model: string;

  constructor(config: UnifiedLLMConfig) {
    super();
    
    // Get preset or use custom
    const preset = PROVIDER_PRESETS[config.provider] || PROVIDER_PRESETS.custom;
    
    // Determine baseURL: user-provided > preset default
    const baseURL = config.baseURL || preset.baseURL;
    
    if (!baseURL) {
      throw new Error(`baseURL is required for provider '${config.provider}'. Please provide it in the config.`);
    }

    this.name = config.provider;
    this.model = config.model;

    // Create the OpenAI-compatible provider
    this.provider = createOpenAICompatible({
      name: preset.name,
      baseURL,
      apiKey: config.apiKey, // undefined for local providers like Ollama
      headers: config.headers,
    });
  }

  async generate(prompt: string, _context: ReviewContext): Promise<string> {
    const { text } = await generateText({
      model: this.provider(this.model),
      prompt,
    });

    return text;
  }
}

/**
 * Factory function to create a unified LLM backend from config
 */
export function createUnifiedBackend(config: UnifiedLLMConfig): UnifiedLLMBackend {
  return new UnifiedLLMBackend(config);
}

/**
 * Create backend from environment variables
 * Priority: env vars > config values
 */
export function createBackendFromEnv(env: Record<string, string | undefined>): UnifiedLLMBackend {
  const provider = (env.LLM_PROVIDER as ProviderName) || 'ollama';
  const model = env.LLM_MODEL || 'qwen3.5:cloud';

  const config: UnifiedLLMConfig = {
    provider,
    model,
  };

  // Set API key based on provider
  switch (provider) {
    case 'openai':
      config.apiKey = env.OPENAI_API_KEY;
      break;
    case 'azure':
      config.apiKey = env.AZURE_OPENAI_KEY;
      config.baseURL = env.AZURE_OPENAI_ENDPOINT;
      break;
    case 'custom':
      config.apiKey = env.CUSTOM_API_KEY;
      config.baseURL = env.CUSTOM_ENDPOINT;
      break;
    case 'ollama':
    default:
      // Ollama doesn't need an API key
      config.baseURL = env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
      break;
  }

  return new UnifiedLLMBackend(config);
}