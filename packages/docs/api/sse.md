# SSE Indexing Progress

The `/api/repos/:id/index/status` endpoint streams real-time indexing progress using Server-Sent Events (SSE).

## Connecting

```javascript
const evtSource = new EventSource('/api/repos/aHR0cHM6.../index/status')

evtSource.onmessage = (event) => {
  const data = JSON.parse(event.data)

  if (data.step === 'parsing') {
    console.log(`Parsing ${data.file} (${data.progress}/${data.total})`)
  }

  if (data.step === 'embedding') {
    console.log(`Embedding symbols (${data.progress}/${data.total})`)
  }

  if (data.step === 'done') {
    console.log(`Done! ${data.symbolCount} symbols, ${data.edgeCount} edges in ${data.durationMs}ms`)
    evtSource.close()
  }
}
```

## Event Schema

### `parsing`

Emitted for each file as it's parsed.

```json
{
  "step": "parsing",
  "file": "src/auth/service.ts",
  "progress": 42,
  "total": 150
}
```

### `embedding`

Emitted after each batch of 32 symbols is embedded (only when `EMBEDDING_PROVIDER` is set).

```json
{
  "step": "embedding",
  "symbolCount": 235,
  "progress": 64,
  "total": 235
}
```

### `done`

Emitted once when the full index (including embedding) is complete.

```json
{
  "step": "done",
  "symbolCount": 235,
  "edgeCount": 1194,
  "durationMs": 48200
}
```

## curl Example

```bash
curl -N http://localhost:3000/api/repos/aHR0cHM6.../index/status
```

The `-N` flag disables buffering so you see events as they arrive.

## Connection Handling

The endpoint keeps the connection open until:
- The `done` event is sent
- The client disconnects

If you connect after indexing has already completed, no events will be streamed (nothing to report). Re-trigger a full index via `POST /api/repos` to see progress again.
