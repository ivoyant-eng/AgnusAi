export interface EmbeddingSearchResult {
  id: string
  score: number
}

export interface EmbeddingAdapter {
  /** Vector dimension produced by this adapter's model. */
  readonly dim: number
  /** Embed a batch of text strings. Returns one float[] per input string. */
  embed(texts: string[]): Promise<number[][]>
  /** Upsert an embedding for a symbol into the vector store. */
  upsert(symbolId: string, repoId: string, branch: string, vector: number[]): Promise<void>
  /** Search for semantically similar symbols. */
  search(queryVector: number[], repoId: string, topK: number): Promise<EmbeddingSearchResult[]>
}
