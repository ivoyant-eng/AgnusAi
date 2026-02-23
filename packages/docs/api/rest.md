# REST API

Base URL: `http://localhost:3000` (or your hosted URL)

All endpoints under `/api/` except `/api/health` and `/api/auth/*` require an authenticated session cookie (`agnus_session`). Obtain it via `POST /api/auth/login`.

---

## Health

### `GET /api/health`

Returns server status. No auth required.

**Response:**
```json
{"status": "ok", "timestamp": "2026-02-23T09:00:00.000Z"}
```

---

## Auth

### `POST /api/auth/login`

Verify email + password, set the `agnus_session` httpOnly cookie.

**Request body:**
```json
{"email": "admin@example.com", "password": "changeme"}
```

**Response (200):** `{"ok": true}` + `Set-Cookie: agnus_session=<jwt>; HttpOnly`

**Response (401):** `{"error": "Invalid credentials"}`

---

### `POST /api/auth/logout`

Clear the session cookie.

**Response (200):** `{"ok": true}`

---

### `GET /api/auth/me`

Return the current user's identity. Requires auth.

**Response:**
```json
{"id": "028cd449-...", "email": "admin@example.com", "role": "admin"}
```

---

### `POST /api/auth/invite` _(admin only)_

Generate a one-time invite link.

**Request body:**
```json
{"email": "colleague@example.com"}
```

**Response:**
```json
{"token": "825bb256...", "url": "http://localhost:3000/login?invite=825bb256..."}
```

---

### `POST /api/auth/register`

Register a new account using an invite token.

**Request body:**
```json
{"token": "825bb256...", "email": "colleague@example.com", "password": "newpassword"}
```

**Response (200):** `{"ok": true}` + `Set-Cookie: agnus_session=<jwt>; HttpOnly`

**Response (400):** `{"error": "Invite already used"}` if the token was already consumed.

---

## Repos

### `GET /api/repos` _(auth required)_

List all registered repositories.

**Response:**
```json
[
  {
    "repoId": "aHR0cHM6...",
    "repoUrl": "https://github.com/owner/repo",
    "platform": "github",
    "repoPath": "/tmp/repo",
    "createdAt": "2026-02-23T07:06:03.136Z"
  }
]
```

---

### `POST /api/repos` _(auth required)_

Register a repository and trigger a full index in the background.

**Request body:**
```json
{
  "repoUrl": "https://github.com/owner/repo",
  "platform": "github",
  "token": "ghp_...",
  "repoPath": "/path/to/local/clone",
  "branches": ["main", "develop"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `repoUrl` | Yes | Full GitHub/Azure URL. Used as the stable repo ID. |
| `platform` | Yes | `"github"` or `"azure"` |
| `token` | No | VCS token for posting review comments. |
| `repoPath` | No | Absolute path on the server to the local clone. Required for indexing. |
| `branches` | No | Branches to index. Defaults to `["main"]`. |

**Response (202):**
```json
{
  "repoId": "aHR0cHM6...",
  "branches": ["main", "develop"],
  "message": "Indexing started for 2 branch(es) — stream progress at /api/repos/.../index/status?branch=<branch>"
}
```

---

### `GET /api/repos/:id/index/status`

Server-Sent Events stream of indexing progress. Add `?branch=develop` to track a specific branch (defaults to `main`).

```
data: {"step":"parsing","file":"src/auth.ts","progress":42,"total":150}
data: {"step":"embedding","symbolCount":235,"progress":64,"total":235}
data: {"step":"done","symbolCount":235,"edgeCount":1194,"durationMs":48200}
```

---

### `GET /api/repos/:id/graph/blast-radius/:symbolId`

Get the blast radius for a specific symbol. `symbolId` is URL-encoded `filePath:qualifiedName`.

**Response:**
```json
{
  "directCallers": [{"id": "app/login/page.tsx:GET", "name": "GET", ...}],
  "transitiveCallers": [...],
  "affectedFiles": ["app/login/page.tsx", "hooks/useAuth.ts"],
  "riskScore": 100
}
```

---

### `DELETE /api/repos/:id` _(auth required)_

Deregister a repo. Removes it from the database and evicts it from the in-memory graph cache.

**Response:** 204 No Content

---

## Reviews

### `GET /api/reviews` _(auth required)_

Return the 50 most recent reviews across all repos.

**Response:**
```json
[
  {
    "id": "uuid",
    "repoId": "aHR0cHM6...",
    "repoUrl": "https://github.com/owner/repo",
    "prNumber": 42,
    "verdict": "needs_work",
    "commentCount": 5,
    "createdAt": "2026-02-23T09:08:39.562Z"
  }
]
```

---

## Settings

### `GET /api/settings` _(auth required)_

Read the current user's review depth setting.

**Response:**
```json
{"reviewDepth": "standard"}
```

---

### `POST /api/settings` _(auth required)_

Update the current user's review depth setting.

**Request body:**
```json
{"reviewDepth": "deep"}
```

**Response:** `{"ok": true}`
