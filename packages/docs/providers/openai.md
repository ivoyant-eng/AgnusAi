# OpenAI

Use GPT models for high-quality reviews via the OpenAI API.

## Setup

```bash
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-proj-...
```

## Available Models

| Model | Notes |
|-------|-------|
| `gpt-4o-mini` | **Recommended** — fast, cheap, follows instructions well |
| `gpt-4o` | Best quality, higher cost |
| `gpt-4-turbo` | Legacy 128K context |
| `o3-mini` | Strong reasoning |

## Cost Estimate

For a typical PR (10 files, ~2000 tokens of diff):
- `gpt-4o-mini`: ~$0.001 per review
- `gpt-4o`: ~$0.01 per review
