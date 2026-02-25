# Embedding Providers — Overview

Embeddings are used in **deep review mode** to find semantically similar symbols via vector search. They're optional — standard and fast modes work without them.

## Model Comparison

| Model | Provider | Dims | Context | Size | Notes |
|-------|----------|------|---------|------|-------|
| `qwen3-embedding:0.6b` | Ollama | 1024 | 40K | 639MB | **Recommended local.** #1 MTEB multilingual, code-aware, CPU-friendly |
| `nomic-embed-text` | Ollama | 768 | 8K | 274MB | Smaller, faster, less accurate |
| `text-embedding-3-small` | OpenAI | 1536 | 8K | cloud | Good quality, $0.02/1M tokens |
| `text-embedding-3-large` | OpenAI | 3072 | 8K | cloud | Highest OpenAI quality, $0.13/1M tokens |
| `text-embedding-ada-002` | Azure | 1536 | 8K | cloud | **Recommended cloud.** Widely available in Azure AI |
| `text-embedding-3-small` | Azure | 1536 | 8K | cloud | Newer Azure model, better quality than ada-002 |
| `text-embedding-004` | Google | 768 | 2K | cloud | Free tier 1500 RPM, code retrieval task type |
| `embed-v4.0` | Cohere (HTTP) | varies | — | cloud | Via generic HTTP adapter |
| `voyage-code-3` | Voyage (HTTP) | 1024 | 32K | cloud | Code-specialized, via HTTP adapter |

::: tip CPU vs GPU for embeddings
Embedding models are much smaller than generation models. `qwen3-embedding:0.6b` (639MB) runs well on CPU at ~200ms per call. You don't need a GPU for embeddings.
:::

::: warning Anthropic / Claude has no embedding API
Claude cannot be used for embeddings. Use any of the providers above alongside Claude for generation.
:::

## Choosing a Provider

- **Local, privacy-first, free:** Use Ollama with `qwen3-embedding:0.6b`
- **Cloud, minimal setup:** Use OpenAI `text-embedding-3-small`
- **Azure stack:** Use `EMBEDDING_PROVIDER=azure` with `text-embedding-ada-002` — same key as your LLM
- **Free cloud:** Use Google `text-embedding-004` (1500 RPM free tier)
- **Code-specialized cloud:** Use Voyage `voyage-code-3` via HTTP adapter

## Dimension Mismatch Warning

Each embedding model produces vectors of a fixed dimension. The `symbol_embeddings` table stores vectors of one specific dimension. If you **change embedding models**, the server will detect the mismatch on startup and automatically drop+recreate the `symbol_embeddings` table. You'll need to re-index all repos after switching models.

## See Also

- [Ollama Embeddings →](./embeddings-ollama)
- [OpenAI Embeddings →](./embeddings-openai)
- [Azure Embeddings →](./azure#azure-embeddings)
- [Google Embeddings →](./embeddings-google)
- [Generic HTTP Embeddings →](./embeddings-http)
