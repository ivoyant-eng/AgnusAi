import { Pool } from 'pg'
import type { EmbeddingAdapter, EmbeddingSearchResult } from './EmbeddingAdapter'

export interface OpenAIEmbeddingConfig {
  apiKey: string
  model?: string          // default: text-embedding-3-small (1536-dim)
  baseUrl?: string        // default: https://api.openai.com/v1
  dim?: number            // default: 1536
  db: Pool
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
}

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  readonly dim: number
  private apiKey: string
  private model: string
  private baseUrl: string
  private db: Pool

  constructor(config: OpenAIEmbeddingConfig) {
    this.apiKey = config.apiKey
    this.model = config.model ?? 'text-embedding-3-small'
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
    // text-embedding-3-small=1536, text-embedding-3-large=3072, text-embedding-ada-002=1536
    this.dim = config.dim ?? 1536
    this.db = config.db
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    })
    if (!res.ok) {
      throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`)
    }
    const data = await res.json() as OpenAIEmbeddingResponse
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
