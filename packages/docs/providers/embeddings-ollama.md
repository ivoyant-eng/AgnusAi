# Ollama Embeddings

Run embeddings entirely locally. No API key, no cost, no data leaving your machine.

## Setup

1. Make sure Ollama is running: `ollama serve`
2. Pull the embedding model:

```bash
# Recommended — best quality, code-aware, 40K context
ollama pull qwen3-embedding:0.6b

# Alternative — smaller, faster, lower quality
ollama pull nomic-embed-text
```

3. Set in `.env`:

```bash
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=qwen3-embedding:0.6b
```

In Docker Compose (where Ollama runs in a container):

```bash
EMBEDDING_BASE_URL=http://ollama:11434
```

## Model Dimensions

| Model | Dimensions | Notes |
|-------|-----------|-------|
| `qwen3-embedding:0.6b` | 1024 | Default — best choice |
| `nomic-embed-text` | 768 | Faster, smaller |
| `mxbai-embed-large` | 1024 | Good alternative |
| `snowflake-arctic-embed` | 1024 | Strong on code |

## Verify It's Working

```bash
curl http://localhost:11434/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-embedding:0.6b","prompt":"function createClient(): SupabaseClient"}'
```

You should see a JSON response with an `embedding` array of 1024 floats.

## Performance

On an M-series Mac (CPU only):
- `qwen3-embedding:0.6b`: ~200ms per call
- `nomic-embed-text`: ~80ms per call

For a repo with 235 symbols, full embedding takes ~50 seconds (sequential). This happens once — subsequent pushes only re-embed changed files.
