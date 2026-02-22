# REST API

Base URL: `http://localhost:3000` (or your hosted URL)

## Health

### `GET /api/health`

Returns server status.

**Response:**
```json
{"status": "ok", "timestamp": "2026-02-22T16:57:04.942Z"}
```

## Repos

### `POST /api/repos`

Register a repository and trigger a full index in the background.

**Request body:**
```json
{
  "repoUrl": "https://github.com/owner/repo",
  "platform": "github",
  "token": "ghp_...",
  "repoPath": "/path/to/local/clone"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `repoUrl` | Yes | Full GitHub/Azure URL. Used as the stable repo ID. |
| `platform` | Yes | `"github"` or `"azure"` |
| `token` | No | VCS token for posting review comments. Can be set later. |
| `repoPath` | No | Absolute path to the local clone. Required for indexing. |

**Response (202):**
```json
{
  "repoId": "aHR0cHM6...",
  "message": "Indexing started — stream progress at /api/repos/aHR0cHM6.../index/status"
}
```

The `repoId` is a URL-safe base64 encoding of the repo URL (first 32 chars).

---

### `GET /api/repos/:id/index/status`

Server-Sent Events stream of indexing progress.

**Response:** SSE stream

```
data: {"step":"parsing","file":"src/auth.ts","progress":42,"total":150}
data: {"step":"embedding","symbolCount":235,"progress":64,"total":235}
data: {"step":"done","symbolCount":235,"edgeCount":1194,"durationMs":48200}
```

Events:

| `step` | Fields | Description |
|--------|--------|-------------|
| `parsing` | `file`, `progress`, `total` | Parsing a source file |
| `embedding` | `symbolCount`, `progress`, `total` | Embedding symbols |
| `done` | `symbolCount`, `edgeCount`, `durationMs` | Index complete |

---

### `GET /api/repos/:id/graph/blast-radius/:symbolId`

Get the blast radius for a specific symbol.

**`symbolId`** format: `filePath:qualifiedName` — URL-encoded. Example:
```
lib%2Fsupabase%2FsupabaseClient.ts%3AcreateClient
```

**Response:**
```json
{
  "directCallers": [
    {"id": "app/login/page.tsx:GET", "name": "GET", "signature": "GET(): Promise<Response>", ...}
  ],
  "transitiveCallers": [...],
  "affectedFiles": ["app/login/page.tsx", "hooks/useAuth.ts"],
  "riskScore": 100
}
```

---

### `DELETE /api/repos/:id`

Deregister a repo. Removes it from the `repos` table and evicts it from the in-memory graph cache. Does **not** delete indexed symbols/edges (they can be reused if the repo is re-registered).

**Response:** 204 No Content
