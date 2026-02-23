# Generic HTTP Embeddings

Use any OpenAI-compatible embedding API: Cohere, Voyage AI, Together AI, Mistral, Azure OpenAI, or any custom endpoint.

## Setup

```bash
EMBEDDING_PROVIDER=http
EMBEDDING_BASE_URL=https://api.cohere.com/compatibility/v1
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=embed-v4.0
```

## Supported Providers

### Cohere

```bash
EMBEDDING_BASE_URL=https://api.cohere.com/compatibility/v1
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=embed-v4.0
```

### Voyage AI (Code-Specialized)

```bash
EMBEDDING_BASE_URL=https://api.voyageai.com/v1
EMBEDDING_API_KEY=pa-...
EMBEDDING_MODEL=voyage-code-3
```

`voyage-code-3` is specialized for code retrieval with 32K context — excellent choice for deep code review.

### Together AI

```bash
EMBEDDING_BASE_URL=https://api.together.xyz/v1
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=togethercomputer/m2-bert-80M-8k-retrieval
```

### Azure OpenAI

```bash
EMBEDDING_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/text-embedding-3-small
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
```

For Azure, you may also need an `api-version` header. This can be added by extending the `HttpEmbeddingAdapter` config's `headers` option (see source: `packages/core/src/embeddings/HttpEmbeddingAdapter.ts`).

## How It Works

The HTTP adapter posts to `${EMBEDDING_BASE_URL}/embeddings` with:

```json
{
  "model": "<EMBEDDING_MODEL>",
  "input": ["signature1", "signature2", ...]
}
```

This is the OpenAI embeddings API format, which is the de-facto standard now supported by all major providers.

## Setting the Vector Dimension

Set `EMBEDDING_DIM` to avoid a schema recreation on first start:

```bash
# voyage-code-3 = 1024 dims
EMBEDDING_MODEL=voyage-code-3
```

The server auto-detects the dimension from the first embedding call and recreates the `symbol_embeddings` table if there's a mismatch.
