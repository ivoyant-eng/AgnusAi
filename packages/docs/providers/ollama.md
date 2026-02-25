# Ollama (Local LLM)

Run the LLM entirely locally. No API key, no cost, no data leaving your machine.

## Setup

1. Install Ollama: [ollama.com](https://ollama.com)
2. Start the server: `ollama serve`
3. Pull a model:

```bash
# Good general-purpose code model (~4.7GB)
ollama pull qwen2.5-coder

# Lighter, faster (~4.1GB)
ollama pull codellama

# Heavier, better quality (use if you have GPU)
ollama pull qwen3.5:397b-cloud   # cloud-hosted via Ollama
```

4. Configure `.env`:

```bash
LLM_PROVIDER=ollama
LLM_MODEL=qwen2.5-coder
OLLAMA_BASE_URL=http://localhost:11434/v1
```

In Docker Compose (Ollama running on the host):

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11434/v1
```

## Recommended Models

| Model | Size | Notes |
|-------|------|-------|
| `qwen2.5-coder` | 4.7GB | Best local code model, strong on reviews |
| `codellama:7b` | 4.1GB | Fast, good baseline |
| `deepseek-coder-v2` | 8.9GB | Strong reasoning, requires more RAM |
| `llama3.1` | 4.9GB | Good general-purpose |

## Verify

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Docker Compose Note

When using Ollama inside Docker Compose, pull models after starting:

```bash
docker compose up -d
docker compose exec ollama ollama pull qwen2.5-coder
docker compose exec ollama ollama pull qwen3-embedding:0.6b
```

Model weights persist in the `ollama-data` volume.
