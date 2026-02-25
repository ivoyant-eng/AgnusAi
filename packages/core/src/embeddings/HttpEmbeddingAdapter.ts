import { Pool } from 'pg'
import type { EmbeddingAdapter, EmbeddingSearchResult } from './EmbeddingAdapter'

/**
 * Generic OpenAI-compatible embedding adapter.
 * Works with: OpenAI, Cohere, Together, Voyage, Mistral, Azure OpenAI,
 * any provider that exposes POST /embeddings with { model, input } body.
 *
 * Set baseUrl to point at any compatible endpoint:
 *   OpenAI:   https://api.openai.com/v1
 *   Cohere:   https://api.cohere.com/compatibility/v1
 *   Together: https://api.together.xyz/v1
 *   Voyage:   https://api.voyageai.com/v1
 *   Azure:    https://<resource>.openai.azure.com/openai/deployments/<deployment>
 */
export interface HttpEmbeddingConfig {
  baseUrl: string       // e.g. "https://api.openai.com/v1"
  apiKey?: string       // Bearer token (omit for unauthenticated local endpoints)
  model: string         // e.g. "text-embedding-3-small", "embed-v4.0"
  dim?: number          // default: 1536
  db: Pool
  headers?: Record<string, string>   // extra headers (e.g. api-key for Azure)
  queryParams?: Record<string, string> // extra query params (e.g. api-version for Azure)
}

interface OAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
}

export class HttpEmbeddingAdapter implements EmbeddingAdapter {
  readonly dim: number
  private config: HttpEmbeddingConfig
  private db: Pool

  constructor(config: HttpEmbeddingConfig) {
    this.config = config
    this.dim = config.dim ?? 1536
    this.db = config.db
  }

  async embed(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    }
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }

    const url = new URL(`${this.config.baseUrl}/embeddings`)
    if (this.config.queryParams) {
      for (const [k, v] of Object.entries(this.config.queryParams)) {
        url.searchParams.set(k, v)
      }
    }
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.config.model, input: texts }),
    })
    if (!res.ok) {
      throw new Error(`HTTP embedding failed [${this.config.baseUrl}]: ${res.status} ${await res.text()}`)
    }
    const data = await res.json() as OAIEmbeddingResponse
    return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
  }

  async upsert(symbolId: string, repoId: string, branch: string, vector: number[]): Promise<void> {
    await this.db.query(
      `INSERT INTO symbol_embeddings (symbol_id, repo_id, branch, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT (symbol_id, repo_id, branch) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [symbolId, repoId, branch, `[${vector.join(',')}]`],
    )
  }

  async search(queryVector: number[], repoId: string, topK: number): Promise<EmbeddingSearchResult[]> {
    const res = await this.db.query<{ symbol_id: string; score: number }>(
      `SELECT symbol_id, 1 - (embedding <=> $1::vector) AS score
       FROM symbol_embeddings
       WHERE repo_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [`[${queryVector.join(',')}]`, repoId, topK],
    )
    return res.rows.map(row => ({ id: row.symbol_id, score: row.score }))
  }
}
