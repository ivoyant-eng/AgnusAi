# Indexing Pipeline

The indexer turns source files into graph nodes, edges, and embedding vectors.

## Supported File Extensions

| Extension | Parser | Languages |
|-----------|--------|-----------|
| `.ts`, `.tsx`, `.js`, `.jsx` | TypeScriptParser | TypeScript, JavaScript, React |
| `.py` | PythonParser | Python |
| `.java` | JavaParser | Java |
| `.go` | GoParser | Go |
| `.cs` | CSharpParser | C# |

## Full Index

Triggered when a repo is first registered via `POST /api/repos`.

```
Walk all source files in repoPath
  ↓
For each file: parse → extract symbols + edges
  ↓
Add symbols/edges to InMemorySymbolGraph
  ↓
Upsert symbols + edges to Postgres
  ↓
Serialize graph → save snapshot to Postgres
  ↓
[if embeddings enabled]
Embed all symbols in batches of 32
  ↓
Upsert vectors to symbol_embeddings (pgvector)
```

Progress is streamed via SSE as it happens.

## Incremental Update

Triggered on every `push` webhook event. Only re-parses changed files.

```
For each changed file:
  graph.removeFile(filePath)        ← clears old symbols/edges from RAM
  storage.deleteByFile(filePath)    ← clears from Postgres
  re-parse file
  add new symbols/edges
  upsert to Postgres
  [if embeddings] re-embed changed symbols
↓
Save updated graph snapshot
```

On a typical push affecting 2–3 files, this completes in under 1 second.

## Skipped Directories

```
node_modules  dist  build  .git  .next
__pycache__   coverage  .turbo  target
```

## Embedding Batching

Symbols are embedded in batches of 32 to avoid overwhelming the embedding server. Each batch makes a single API call for HTTP-based providers (OpenAI, Google, HTTP), or 32 sequential calls for Ollama (which doesn't support batch input natively).

Progress is reported per batch, so the SSE stream advances smoothly.

## What Is NOT Stored

By design, raw source code is never persisted:
- No file contents
- No line contents
- No AST nodes

Only: symbol signatures, edge metadata, and embedding vectors.

## Fault Tolerance

- If a file fails to parse (syntax error, binary file), it's skipped with a warning
- If an embedding batch fails (network error, model not loaded), it's skipped with a warning and indexing continues
- Parser initialization errors (e.g. WASM ABI mismatch for Go parser) skip only that parser — other languages are unaffected
