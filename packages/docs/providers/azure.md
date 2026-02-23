# Azure OpenAI

Use Azure-hosted OpenAI models for enterprise deployments.

## Setup

```bash
LLM_PROVIDER=azure
LLM_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/gpt-4o
LLM_API_KEY=...
LLM_MODEL=gpt-4o
```

The `LLM_BASE_URL` should point to your specific deployment endpoint.

## Azure Embeddings

For embeddings via Azure, use the `http` provider:

```bash
EMBEDDING_PROVIDER=http
EMBEDDING_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/text-embedding-3-small
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
```
