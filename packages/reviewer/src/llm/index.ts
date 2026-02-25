// LLM Backend Index
// Unified backend using Vercel AI SDK - supports all OpenAI-compatible providers
export { LLMBackend } from './base';
export {
  UnifiedLLMBackend,
  createBackendFromEnv,
  type ProviderName,
  type UnifiedLLMConfig,
} from './unified';

// Legacy exports for backward compatibility (deprecated)
export { OllamaBackend, createOllamaBackend } from './ollama';
export { ClaudeBackend, createClaudeBackend } from './claude';
export { OpenAIBackend, createOpenAIBackend } from './openai';
