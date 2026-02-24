# Architecture Overview

AgnusAI v2 is a pnpm monorepo with five packages built in strict dependency order.

## Package Map

```
packages/
├── shared/     — shared TypeScript types (ParsedSymbol, Edge, BlastRadius, …)
├── core/       — Tree-sitter parsers, InMemorySymbolGraph, Indexer, Retriever, Embeddings
├── reviewer/   — CLI reviewer (Layer 0 — unchanged from v1)
├── api/        — Fastify server (webhooks, REST, SSE, auth, landing page)
├── dashboard/  — Vite React SPA — served at /app/ (login, repos, reviews, settings)
└── docs/       — VitePress documentation (this site) — served at /docs/
```

## Data Flow

```
                    ┌─────────────────────────────────────┐
                    │         GitHub / Azure DevOps        │
                    └────────────┬────────────┬────────────┘
                                 │ push        │ PR open/sync
                                 ▼             ▼
                    ┌─────────────────────────────────────┐
                    │          Fastify API (port 3000)     │
                    │   POST /webhooks/github              │
                    └──────┬──────────────┬───────────────┘
                           │               │
                    ┌──────▼──────┐  ┌─────▼──────────────────────┐
                    │  Indexer    │  │  review-runner               │
                    │  (core)     │  │                              │
                    │  parse →    │  │  1. Retriever: graph BFS +   │
                    │  graph →    │  │     embedding search         │
                    │  embed →    │  │     → GraphReviewContext      │
                    │  store      │  │  2. RAG: embed diff, query   │
                    └──────┬──────┘  │     accepted comments        │
                           │         │     → priorExamples[]        │
                           │         │  3. PRReviewAgent: LLM prompt│
                           │         │     → post to GitHub/Azure   │
                           │         │  4. Embed + store comments   │
                           │         └─────────────┬────────────────┘
                           │                       │
                    ┌──────▼───────────────────────▼───────┐
                    │           Postgres + pgvector          │
                    │   symbols, edges, graph_snapshots,     │
                    │   symbol_embeddings,                   │
                    │   reviews, review_comments (+ vectors),│
                    │   review_feedback                      │
                    └───────────────────┬────────────────────┘
                                        │ GET /api/feedback?signal=accepted
                                        │ (developer clicks 👍 in GitHub)
                    ┌───────────────────▼────────────────────┐
                    │         Feedback Learning Loop          │
                    │  accepted comments → embedded → stored  │
                    │  next PR: top-5 examples injected into  │
                    │  LLM prompt as team-specific guidance   │
                    └────────────────────────────────────────┘
```

## Key Design Decisions

### Tree-sitter, not LSP

Language parsing uses `web-tree-sitter` (WASM bindings), not Language Server Protocol. This means:
- **Incremental** — fast re-parse of individual files on push
- **Deterministic** — same output every time, no daemon state
- **Multi-language** — TypeScript, Python, Java, Go, C# with the same API
- **No language server to manage** — the WASM files are bundled

### In-memory graph, not Neo4j

`InMemorySymbolGraph` is an adjacency list with two maps (`inEdges`, `outEdges`) and a `nameToIds` index. At 100k symbols it fits comfortably in ~50MB of RAM and BFS traversal takes microseconds. Snapshots are persisted to Postgres as JSON for restart recovery.

### Postgres + pgvector, not a vector database

Embedding search uses Postgres's `<=>` cosine distance operator from the `pgvector` extension. This keeps the stack simple: one database handles symbols, edges, graph snapshots, and vectors.

### Privacy by design

Raw source code is never stored. Only:
- Symbol signatures (e.g. `function createClient(): SupabaseClient`)
- Graph edges (caller → callee)
- Embedding vectors
- Graph topology snapshots

### Layer 0 is never broken

The CLI reviewer (`packages/reviewer`) is treated as an inviolable foundation. All v2 additions are purely additive. The only change to reviewer is an optional `graphContext?` field injected by the API.

## See Also

- [Monorepo Layers →](./layers)
- [Graph Engine →](./graph-engine)
- [Indexing Pipeline →](./indexing)
- [Retriever & RAG →](./retriever)
