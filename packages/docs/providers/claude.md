# Claude (Anthropic)

Use Claude models for code review via the Anthropic API.

## Setup

```bash
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6
```

## Available Models

| Model ID | Notes |
|----------|-------|
| `claude-sonnet-4-6` | **Recommended** — excellent code understanding |
| `claude-opus-4-6` | Highest quality, most capable |
| `claude-haiku-4-5-20251001` | Fastest, cheapest |

## No Embedding API

::: warning
Anthropic/Claude does not have a public embedding API. Use any other provider for embeddings (Ollama, OpenAI, Google, or HTTP).

Example: Claude for LLM + Ollama for embeddings:
```bash
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6

EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=qwen3-embedding:0.6b
```
:::
