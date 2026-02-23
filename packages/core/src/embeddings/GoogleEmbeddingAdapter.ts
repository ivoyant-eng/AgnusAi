import { Pool } from 'pg'
import type { EmbeddingAdapter, EmbeddingSearchResult } from './EmbeddingAdapter'

/**
 * Google text-embedding-004 via Generative Language API (no Vertex AI required).
 * Free tier: 1500 RPM, 1M tokens/min.
 * Dimensions: 768 (fixed for text-embedding-004).
 */
export interface GoogleEmbeddingConfig {
  apiKey: string
  model?: string    // default: text-embedding-004 (768-dim)
  dim?: number      // default: 768
  db: Pool
}

interface GoogleEmbedResponse {
  embedding: { values: number[] }
}

export class GoogleEmbeddingAdapter implements EmbeddingAdapter {
  readonly dim: number
  private apiKey: string
  private model: string
  private db: Pool

  constructor(config: GoogleEmbeddingConfig) {
    this.apiKey = config.apiKey
    this.model = config.model ?? 'text-embedding-004'
    this.dim = config.dim ?? 768  // text-embedding-004 is 768-dim
    this.db = config.db
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    for (const text of texts) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            taskType: 'CODE_RETRIEVAL_QUERY',
          }),
        },
      )
      if (!res.ok) {
        throw new Error(`Google embeddings failed: ${res.status} ${await res.text()}`)
      }
      const data = await res.json() as GoogleEmbedResponse
      results.push(data.embedding.values)
    }
    return results
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
