// Unified LLM Backend — routes to the right native AI SDK provider.
//
// Set LLM_PROVIDER to one of: ollama | openai | azure | claude | custom
//
// Provider-specific env vars:
//   ollama  → OLLAMA_BASE_URL (default http://localhost:11434/v1)
//   openai  → OPENAI_API_KEY
//   azure   → AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_API_VERSION
//   claude  → ANTHROPIC_API_KEY
//   custom  → CUSTOM_LLM_URL, CUSTOM_LLM_API_KEY
//
// All providers use LLM_MODEL for the model/deployment name.

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { BaseLLMBackend } from './base';
import { ReviewContext } from '../types';

export type ProviderName = 'ollama' | 'openai' | 'azure' | 'claude' | 'custom';

export interface UnifiedLLMConfig {
  provider: ProviderName;
  model: string;
  // openai
  openAiApiKey?: string;
  // azure — uses openai-compatible with api-key header (supports cognitiveservices.azure.com endpoints)
  azureEndpoint?: string;      // full deployment URL: https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>
  azureApiKey?: string;
  azureApiVersion?: string;
  // claude
  anthropicApiKey?: string;
  // ollama / custom
  baseURL?: string;
  customApiKey?: string;
}

export class UnifiedLLMBackend extends BaseLLMBackend {
  readonly name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private languageModel: any;

  constructor(config: UnifiedLLMConfig) {
    super();
    this.name = config.provider;
    this.languageModel = buildLanguageModel(config);
  }

  async generate(prompt: string, _context: ReviewContext): Promise<string> {
    const { text } = await generateText({
      model: this.languageModel,
      prompt,
    });
    return text;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLanguageModel(config: UnifiedLLMConfig): any {
  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: config.openAiApiKey });
      return openai(config.model);
    }

    case 'azure': {
      // Azure AI Foundry / Cognitive Services endpoints use deployment-scoped URLs
      // and the 'api-key' header (not Authorization: Bearer). The openai-compatible
      // adapter handles this correctly; @ai-sdk/azure targets openai.azure.com format.
      if (!config.azureEndpoint) {
        throw new Error('AZURE_OPENAI_ENDPOINT is required for azure provider');
      }
      const azure = createOpenAICompatible({
        name: 'azure',
        baseURL: config.azureEndpoint,
        headers: { 'api-key': config.azureApiKey ?? '' },
        queryParams: { 'api-version': config.azureApiVersion ?? '2025-01-01-preview' },
      });
      return azure(config.model);
    }

    case 'claude': {
      const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });
      return anthropic(config.model);
    }

    case 'ollama':
    case 'custom':
    default: {
      if (!config.baseURL) {
        throw new Error(`baseURL is required for provider '${config.provider}'`);
      }
      const compat = createOpenAICompatible({
        name: config.provider,
        baseURL: config.baseURL,
        apiKey: config.customApiKey,
      });
      return compat(config.model);
    }
  }
}

/** Build backend from typed env vars */
export function createBackendFromEnv(env: NodeJS.ProcessEnv): UnifiedLLMBackend {
  const provider = (env.LLM_PROVIDER ?? 'ollama') as ProviderName;
  const model = env.LLM_MODEL ?? 'qwen3.5:cloud';

  switch (provider) {
    case 'openai':
      return new UnifiedLLMBackend({ provider, model, openAiApiKey: env.OPENAI_API_KEY });

    case 'azure':
      return new UnifiedLLMBackend({
        provider,
        model,
        azureEndpoint: env.AZURE_OPENAI_ENDPOINT,
        azureApiKey: env.AZURE_OPENAI_API_KEY,
        azureApiVersion: env.AZURE_API_VERSION ?? '2025-01-01-preview',
      });

    case 'claude':
      return new UnifiedLLMBackend({ provider, model, anthropicApiKey: env.ANTHROPIC_API_KEY });

    case 'custom':
      return new UnifiedLLMBackend({ provider, model, baseURL: env.CUSTOM_LLM_URL, customApiKey: env.CUSTOM_LLM_API_KEY });

    case 'ollama':
    default:
      return new UnifiedLLMBackend({
        provider: 'ollama',
        model,
        baseURL: env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
      });
  }
}
