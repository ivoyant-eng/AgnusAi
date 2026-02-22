# Google Embeddings

Google's `text-embedding-004` via the Generative Language API. No Vertex AI required.

## Setup

Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
EMBEDDING_PROVIDER=google
EMBEDDING_API_KEY=AIza...
EMBEDDING_MODEL=text-embedding-004
```

## Free Tier

- 1,500 requests per minute
- 1 million tokens per minute
- No credit card required for the free tier

This is more than enough for any repo indexing workload.

## Model Details

| Model | Dimensions | Context | Notes |
|-------|-----------|---------|-------|
| `text-embedding-004` | 768 | 2K tokens | Uses `CODE_RETRIEVAL_QUERY` task type |

The adapter uses `taskType: "CODE_RETRIEVAL_QUERY"` which is optimized for code search and retrieval tasks.

## Limitations

- **2K token context limit** — long functions may be truncated. Signatures are typically well under this limit.
- Sequential embedding (one call per symbol) — no batch endpoint in the REST API

## Verify

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=$GOOGLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "models/text-embedding-004",
    "content": {"parts": [{"text": "function createClient(): SupabaseClient"}]},
    "taskType": "CODE_RETRIEVAL_QUERY"
  }'
```
