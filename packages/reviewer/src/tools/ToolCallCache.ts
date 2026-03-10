/**
 * Session-scoped cache shared across all agents in a single review run.
 * Prevents redundant disk reads when multiple agents inspect the same file or symbol.
 * Lifetime: one review session — created in review-runner.ts, garbage-collected after.
 */
export class ToolCallCache {
  private readonly cache = new Map<string, string>()

  get(key: string): string | undefined {
    return this.cache.get(key)
  }

  set(key: string, value: string): void {
    this.cache.set(key, value)
  }

  get size(): number {
    return this.cache.size
  }
}
