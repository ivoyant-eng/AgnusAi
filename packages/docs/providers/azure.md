# Azure OpenAI

Use Azure-hosted OpenAI models for enterprise deployments. Supports both `openai.azure.com` and `cognitiveservices.azure.com` (Azure AI Foundry) endpoints.

## LLM Setup

```bash
LLM_PROVIDER=azure
LLM_MODEL=gpt-4o                  # deployment name in Azure AI Foundry
AZURE_OPENAI_ENDPOINT=https://my-resource.cognitiveservices.azure.com/openai/deployments/gpt-4o
AZURE_OPENAI_API_KEY=...
AZURE_API_VERSION=2025-01-01-preview   # optional — this is the default
```

`AZURE_OPENAI_ENDPOINT` must be the **deployment-scoped** URL. Find it in the Azure portal under your deployment → "Target URI".

## Recommended Models

| Deployment | Notes |
|------------|-------|
| `gpt-4o` | Best quality — follows complex instructions reliably, including confidence scoring |
| `gpt-4o-mini` | Cheaper, faster — may skip confidence markers on complex prompts |
| `gpt-4-turbo` | Legacy 128K context |

::: tip gpt-4o vs gpt-4o-mini
`gpt-4o-mini` sometimes omits the `[Confidence: X.X]` marker required for the precision filter and calibration table. Use `gpt-4o` if confidence scores matter to you.
:::

## Azure Embeddings

AgnusAI has a native `azure` embedding provider — no workarounds needed.

```bash
EMBEDDING_PROVIDER=azure
EMBEDDING_MODEL=text-embedding-ada-002    # deployment name
EMBEDDING_BASE_URL=https://my-resource.cognitiveservices.azure.com/openai/deployments/text-embedding-ada-002
EMBEDDING_API_KEY=...                     # same subscription key as LLM
# AZURE_API_VERSION is reused automatically
```

| Model | Dims | Notes |
|-------|------|-------|
| `text-embedding-ada-002` | 1536 | Reliable, widely available |
| `text-embedding-3-small` | 1536 | Newer, better quality |
| `text-embedding-3-large` | 3072 | Highest quality |

## Full Azure Stack Example

Everything through Azure — no local Ollama required:

```bash
# LLM
LLM_PROVIDER=azure
LLM_MODEL=gpt-4o
AZURE_OPENAI_ENDPOINT=https://my-resource.cognitiveservices.azure.com/openai/deployments/gpt-4o
AZURE_OPENAI_API_KEY=Efq4...
AZURE_API_VERSION=2025-01-01-preview

# Embeddings (uses same key and api-version)
EMBEDDING_PROVIDER=azure
EMBEDDING_MODEL=text-embedding-ada-002
EMBEDDING_BASE_URL=https://my-resource.cognitiveservices.azure.com/openai/deployments/text-embedding-ada-002
EMBEDDING_API_KEY=Efq4...

REVIEW_DEPTH=deep
```

::: warning Dimension mismatch on switch
If you switch from Ollama embeddings (1024-dim) to Azure ada-002 (1536-dim), the server detects the mismatch on startup and automatically recreates the `symbol_embeddings` table. Re-index your repos after switching.
:::
