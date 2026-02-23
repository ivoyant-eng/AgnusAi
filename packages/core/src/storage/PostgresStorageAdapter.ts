import { Pool, PoolConfig } from 'pg'
import type { ParsedSymbol, Edge } from '@agnus-ai/shared'
import type { StorageAdapter } from './StorageAdapter'

const BASE_DDL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS symbols (
  id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT NOT NULL,
  body_start INT,
  body_end INT,
  doc_comment TEXT,
  PRIMARY KEY (id, repo_id, branch)
);

CREATE TABLE IF NOT EXISTS edges (
  id SERIAL PRIMARY KEY,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_snapshots (
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  snapshot TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (repo_id, branch)
);
`

const BRANCH_MIGRATION_DDL = `
DO $$
BEGIN
  -- symbols: add branch column and update PK if needed
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'symbols'::regclass AND attname = 'branch' AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE symbols ADD COLUMN branch TEXT NOT NULL DEFAULT 'main';
    ALTER TABLE symbols DROP CONSTRAINT IF EXISTS symbols_pkey;
    ALTER TABLE symbols ADD PRIMARY KEY (id, repo_id, branch);
  END IF;

  -- edges: add branch column if needed
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'edges'::regclass AND attname = 'branch' AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE edges ADD COLUMN branch TEXT NOT NULL DEFAULT 'main';
  END IF;

  -- graph_snapshots: add branch column and update PK if needed
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'graph_snapshots'::regclass AND attname = 'branch' AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE graph_snapshots ADD COLUMN branch TEXT NOT NULL DEFAULT 'main';
    ALTER TABLE graph_snapshots DROP CONSTRAINT IF EXISTS graph_snapshots_pkey;
    ALTER TABLE graph_snapshots ADD PRIMARY KEY (repo_id, branch);
  END IF;

  -- symbol_embeddings: add branch column and update PK if needed
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'symbol_embeddings') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'symbol_embeddings'::regclass AND attname = 'branch' AND attnum > 0 AND NOT attisdropped
    ) THEN
      ALTER TABLE symbol_embeddings ADD COLUMN branch TEXT NOT NULL DEFAULT 'main';
      ALTER TABLE symbol_embeddings DROP CONSTRAINT IF EXISTS symbol_embeddings_pkey;
      ALTER TABLE symbol_embeddings ADD PRIMARY KEY (symbol_id, repo_id, branch);
    END IF;
  END IF;
END$$;
`

function embeddingTableDDL(dim: number): string {
  return `
CREATE TABLE IF NOT EXISTS symbol_embeddings (
  symbol_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  embedding vector(${dim}),
  PRIMARY KEY (symbol_id, repo_id, branch)
);`
}

export class PostgresStorageAdapter implements StorageAdapter {
  private pool: Pool

  constructor(config: Pool | PoolConfig | string) {
    if (config instanceof Pool) {
      this.pool = config
    } else {
      this.pool = new Pool(typeof config === 'string' ? { connectionString: config } : config)
    }
  }

  /**
   * Run DDL to set up tables. Safe to call multiple times (idempotent).
   * @param vectorDim  Dimension of the embedding vectors to store.
   */
  async migrate(vectorDim = 1024): Promise<void> {
    await this.pool.query(BASE_DDL)

    // Apply branch column migrations for existing tables
    await this.pool.query(BRANCH_MIGRATION_DDL)

    // Check if symbol_embeddings already exists and has the right dimension
    const existing = await this.pool.query<{ atttypmod: number }>(`
      SELECT a.atttypmod
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'symbol_embeddings'
        AND a.attname = 'embedding'
        AND a.attnum > 0
    `)

    if (existing.rows.length > 0) {
      // pgvector stores dim as (dim + 4) in atttypmod
      const currentDim = existing.rows[0].atttypmod - 4
      if (currentDim !== vectorDim) {
        console.warn(
          `[Storage] symbol_embeddings dimension mismatch: existing=${currentDim}, required=${vectorDim}. ` +
          `Dropping and recreating table.`,
        )
        await this.pool.query('DROP TABLE symbol_embeddings')
        await this.pool.query(embeddingTableDDL(vectorDim))
      }
      // else: right dimension, nothing to do
    } else {
      await this.pool.query(embeddingTableDDL(vectorDim))
    }
  }

  async saveSymbols(symbols: ParsedSymbol[], branch: string): Promise<void> {
    if (symbols.length === 0) return
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const s of symbols) {
        await client.query(
          `INSERT INTO symbols
             (id, repo_id, branch, file_path, name, qualified_name, kind, signature, body_start, body_end, doc_comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (id, repo_id, branch) DO UPDATE SET
             file_path = EXCLUDED.file_path,
             name = EXCLUDED.name,
             qualified_name = EXCLUDED.qualified_name,
             kind = EXCLUDED.kind,
             signature = EXCLUDED.signature,
             body_start = EXCLUDED.body_start,
             body_end = EXCLUDED.body_end,
             doc_comment = EXCLUDED.doc_comment`,
          [
            s.id, s.repoId, branch, s.filePath, s.name, s.qualifiedName,
            s.kind, s.signature, s.bodyRange[0], s.bodyRange[1],
            s.docComment ?? null,
          ],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async saveEdges(edges: Edge[], branch: string): Promise<void> {
    if (edges.length === 0) return
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const e of edges) {
        await client.query(
          `INSERT INTO edges (repo_id, branch, from_id, to_id, kind) VALUES ($1,$2,$3,$4,$5)`,
          [(e as any).repoId ?? '', branch, e.from, e.to, e.kind],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async deleteByFile(filePath: string, repoId: string, branch: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `DELETE FROM edges WHERE repo_id = $1 AND branch = $2 AND (from_id LIKE $3 OR to_id LIKE $3)`,
        [repoId, branch, `${filePath}:%`],
      )
      await client.query(
        `DELETE FROM symbols WHERE repo_id = $1 AND branch = $2 AND file_path = $3`,
        [repoId, branch, filePath],
      )
      await client.query(
        `DELETE FROM symbol_embeddings WHERE repo_id = $1 AND branch = $2 AND symbol_id LIKE $3`,
        [repoId, branch, `${filePath}:%`],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async deleteAllForBranch(repoId: string, branch: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM edges WHERE repo_id = $1 AND branch = $2`, [repoId, branch])
      await client.query(`DELETE FROM symbols WHERE repo_id = $1 AND branch = $2`, [repoId, branch])
      await client.query(`DELETE FROM symbol_embeddings WHERE repo_id = $1 AND branch = $2`, [repoId, branch])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async loadAll(repoId: string, branch: string): Promise<{ symbols: ParsedSymbol[]; edges: Edge[] }> {
    const symsRes = await this.pool.query(
      `SELECT id, repo_id, file_path, name, qualified_name, kind, signature, body_start, body_end, doc_comment
       FROM symbols WHERE repo_id = $1 AND branch = $2`,
      [repoId, branch],
    )
    const edgesRes = await this.pool.query(
      `SELECT from_id, to_id, kind FROM edges WHERE repo_id = $1 AND branch = $2`,
      [repoId, branch],
    )

    const symbols: ParsedSymbol[] = symsRes.rows.map(row => ({
      id: row.id,
      repoId: row.repo_id,
      filePath: row.file_path,
      name: row.name,
      qualifiedName: row.qualified_name,
      kind: row.kind,
      signature: row.signature,
      bodyRange: [row.body_start, row.body_end] as [number, number],
      docComment: row.doc_comment ?? undefined,
    }))

    const edges: Edge[] = edgesRes.rows.map(row => ({
      from: row.from_id,
      to: row.to_id,
      kind: row.kind,
    }))

    return { symbols, edges }
  }

  async saveGraphSnapshot(repoId: string, branch: string, json: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO graph_snapshots (repo_id, branch, snapshot, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (repo_id, branch) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
      [repoId, branch, json],
    )
  }

  async loadGraphSnapshot(repoId: string, branch: string): Promise<string | null> {
    const res = await this.pool.query(
      `SELECT snapshot FROM graph_snapshots WHERE repo_id = $1 AND branch = $2`,
      [repoId, branch],
    )
    return res.rows[0]?.snapshot ?? null
  }

  async end(): Promise<void> {
    await this.pool.end()
  }
}
