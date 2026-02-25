/**
 * Creates an EmbeddingAdapter based on EMBEDDING_PROVIDER env var.
 *
 * Supported providers:
 *   ollama  — local Ollama (default, CPU-friendly)
 *   openai  — OpenAI text-embedding-3-small / text-embedding-3-large
 *   google  — Google text-embedding-004 (free tier 1500 RPM)
 *   http    — Any OpenAI-compatible endpoint (Cohere, Voyage, Together, Azure, etc.)
 *
 * Returns null if EMBEDDING_PROVIDER is not set or unrecognized.
 */
import type { Pool } from 'pg'
import type { EmbeddingAdapter } from '@agnus-ai/core'
import {
  OllamaEmbeddingAdapter,
  OpenAIEmbeddingAdapter,
  GoogleEmbeddingAdapter,
  HttpEmbeddingAdapter,
} from '@agnus-ai/core'

export function createEmbeddingAdapter(pool: Pool): EmbeddingAdapter | null {
  const provider = process.env.EMBEDDING_PROVIDER?.toLowerCase()
  const model = process.env.EMBEDDING_MODEL
  const apiKey = process.env.EMBEDDING_API_KEY
  const baseUrl = process.env.EMBEDDING_BASE_URL

  switch (provider) {
    case 'ollama':
      return new OllamaEmbeddingAdapter({
        baseUrl: baseUrl ?? 'http://localhost:11434',
        model: model ?? 'nomic-embed-text',
        db: pool,
      })

    case 'openai':
      if (!apiKey) {
        console.warn('[EmbeddingFactory] EMBEDDING_PROVIDER=openai but EMBEDDING_API_KEY is not set — embeddings disabled')
        return null
      }
      return new OpenAIEmbeddingAdapter({
        apiKey,
        model: model ?? 'text-embedding-3-small',
        baseUrl: baseUrl,
        db: pool,
      })

    case 'google':
      if (!apiKey) {
        console.warn('[EmbeddingFactory] EMBEDDING_PROVIDER=google but EMBEDDING_API_KEY is not set — embeddings disabled')
        return null
      }
      return new GoogleEmbeddingAdapter({
        apiKey,
        model: model ?? 'text-embedding-004',
        db: pool,
      })

    case 'azure': {
      // Azure OpenAI embedding: deployment-scoped baseURL + api-key header + api-version query param
      // EMBEDDING_BASE_URL: https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>
      if (!baseUrl) {
        console.warn('[EmbeddingFactory] EMBEDDING_PROVIDER=azure but EMBEDDING_BASE_URL is not set — embeddings disabled')
        return null
      }
      if (!apiKey) {
        console.warn('[EmbeddingFactory] EMBEDDING_PROVIDER=azure but EMBEDDING_API_KEY is not set — embeddings disabled')
        return null
      }
      return new HttpEmbeddingAdapter({
        baseUrl,
        model: model ?? 'text-embedding-ada-002',
        headers: { 'api-key': apiKey },
        queryParams: { 'api-version': process.env.AZURE_API_VERSION ?? '2025-01-01-preview' },
        db: pool,
      })
    }

    case 'http':
      if (!baseUrl) {
        console.warn('[EmbeddingFactory] EMBEDDING_PROVIDER=http but EMBEDDING_BASE_URL is not set — embeddings disabled')
        return null
      }
      return new HttpEmbeddingAdapter({
        baseUrl,
        apiKey,
        model: model ?? 'text-embedding-3-small',
        db: pool,
      })

    default:
      if (provider) {
        console.warn(`[EmbeddingFactory] Unknown EMBEDDING_PROVIDER="${provider}" — embeddings disabled`)
      }
      return null
  }
}
