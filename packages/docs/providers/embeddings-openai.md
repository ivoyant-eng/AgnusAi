# OpenAI Embeddings

Use OpenAI's embedding API for high-quality cloud embeddings.

## Setup

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small   # or text-embedding-3-large
```

No `EMBEDDING_BASE_URL` needed (defaults to `https://api.openai.com/v1`).

## Available Models

| Model | Dimensions | Cost | Notes |
|-------|-----------|------|-------|
| `text-embedding-3-small` | 1536 | $0.02/1M tokens | **Recommended** — good balance |
| `text-embedding-3-large` | 3072 | $0.13/1M tokens | Highest quality |
| `text-embedding-ada-002` | 1536 | $0.10/1M tokens | Legacy |

## Cost Estimate

For a 235-symbol repo using `text-embedding-3-small`:
- ~235 × ~20 tokens per signature = ~4,700 tokens
- Cost: **$0.0001** (less than a cent for a full index)

Re-indexing on push only re-embeds changed files — typically a few symbols.

## Batch Processing

OpenAI embeddings are batched: all 32 symbols in a batch are sent in a single API call, which is much faster than Ollama's per-call approach.

## Verify

```bash
curl https://api.openai.com/v1/embeddings \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"text-embedding-3-small","input":["function createClient()"]}'
```
