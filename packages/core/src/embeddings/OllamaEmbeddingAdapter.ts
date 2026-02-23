import { Pool } from 'pg'
import type { EmbeddingAdapter, EmbeddingSearchResult } from './EmbeddingAdapter'

export interface OllamaEmbeddingConfig {
  baseUrl?: string        // default: http://localhost:11434
  model?: string          // default: nomic-embed-text
  dim?: number            // vector dimension (detected from first embed call if omitted)
  db: Pool
}

export class OllamaEmbeddingAdapter implements EmbeddingAdapter {
  readonly dim: number
  private baseUrl: string
  private model: string
  private db: Pool

  constructor(config: OllamaEmbeddingConfig) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434'
    this.model = config.model ?? 'nomic-embed-text'
    // Default 1024 for qwen3-embedding:0.6b; set explicitly for other models
    // e.g. nomic-embed-text=768, mxbai-embed-large=1024, snowflake-arctic-embed=1024
    this.dim = config.dim ?? 1024
    this.db = config.db
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      })
      if (!res.ok) {
        throw new Error(`Ollama embeddings failed: ${res.status} ${await res.text()}`)
      }
      const data = await res.json() as { embedding: number[] }
      results.push(data.embedding)
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
