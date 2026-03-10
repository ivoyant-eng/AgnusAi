# VCS Installation Management — Saved App Profiles

## Problem

GitHub App credentials (App ID, PEM, Installation ID) are re-entered on every repo connect.
There is no concept of a saved "auth identity" for a platform account/org.
The Ready page wizard re-asks for credentials already configured.
No support for managing multiple orgs or future VCS platforms (Azure, GitLab, Bitbucket).

---

## Mental Model

A **VCS Installation** = a trusted auth identity for one account/org on one platform.

| Platform | What it represents |
|---|---|
| GitHub | GitHub App installed on a user account or org (App ID + PEM + Installation ID) |
| Azure DevOps | Service connection: PAT or Entra app registration (client_id + secret + tenant_id) |
| GitLab | GitLab OAuth app or group-scoped token |
| Bitbucket | Bitbucket App password or OAuth consumer |

Set up once per account/org. Pick repos from it. No credential re-entry.

---

## User Flows

### GitHub App — First time

```
Connect page → Platform: GitHub
  → No saved installations → "Set up GitHub App" inline form
    → App ID + upload PEM + Installation ID
    → [Save Installation] → API validates → stores profile
  → Installation card appears, repo picker loads
  → Select repo + branch → [Connect Repository]
```

### GitHub App — Already configured (common case)

```
Connect page → Platform: GitHub
  → Installation card(s) shown:
      ┌──────────────────────────────────┐
      │ ✓ theashishmaurya  (User)        │
      │   App #3015655 · 166 repos       │
      └──────────────────────────────────┘
  → Repo picker loads immediately (no credential entry)
  → Select repo + branch → [Connect Repository]
```

### GitHub App — Multiple orgs

```
Connect page → [+ Add another installation]
  → Inline form for new org's App credentials
  → Second installation card appears
  → User picks which installation's repo to connect
```

### Azure DevOps — PAT (current, iteration 1)

```
Connect page → Platform: Azure DevOps
  → PAT field (as today, no change)
  → Repo URL + branch → Connect
```

### Azure DevOps — Entra App (iteration 2, planned)

```
Connect page → Platform: Azure DevOps
  → Saved Azure connections shown (same card pattern)
  → "+ Add Azure connection" → client_id + secret + tenant_id + org URL
  → Repo picker fetches from Azure DevOps API
  → Select repo → Connect
```

### GitLab / Bitbucket (future)

Same card-based pattern. Credentials differ but the concept is identical.

---

## Ready Page Flow

**Before this plan:** wizard always shown, steps re-ask for credentials.

**After:**
- Repo already has an App installation linked → skip steps 1-3, show "Bot identity active" immediately
- First time (no App configured) → show 4-step wizard as before
- After step 3 succeeds → `localStorage.setItem('ryv:app-ready:${repoId}', '1')` so it never asks again

---

## Data Model

### New table: `vcs_installations`

```sql
CREATE TABLE IF NOT EXISTS vcs_installations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,            -- 'github' | 'azure' | 'gitlab' | 'bitbucket'
  display_name TEXT,                    -- user-set label, e.g. "theashishmaurya personal"
  account_login TEXT,                   -- populated from platform API on save
  account_type  TEXT,                   -- 'User' | 'Organization' | 'Team'

  -- GitHub App fields
  github_app_id            TEXT,
  github_app_private_key   TEXT,
  github_app_installation_id TEXT,

  -- Azure Entra ID fields (iteration 2)
  azure_client_id     TEXT,
  azure_client_secret TEXT,
  azure_tenant_id     TEXT,
  azure_org_url       TEXT,

  -- Generic PAT fallback (any platform)
  pat TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `repos` table — add FK reference

```sql
ALTER TABLE repos ADD COLUMN IF NOT EXISTS vcs_installation_id UUID
  REFERENCES vcs_installations(id) ON DELETE SET NULL;
```

Existing repos with inline `github_app_id/private_key/installation_id` continue to work.
New repos set via installation card populate both the FK and the inline columns (for backward compat
with review-runner and webhook handlers that read inline columns today).

---

## API Changes

### New routes — `GET/POST/DELETE /api/vcs-installations`

```
GET  /api/vcs-installations
  → list all saved installations for active org
  → returns: id, platform, display_name, account_login, account_type, github_app_id,
             github_app_installation_id, created_at
  → never returns private_key / client_secret

POST /api/vcs-installations
  → body: { platform, displayName?, appId, privateKey, installationId }
  → validates credentials against platform API (listReposAccessibleToInstallation)
  → populates account_login + account_type from API response
  → returns saved installation (no secrets)

DELETE /api/vcs-installations/:id
  → removes installation (repos with FK get SET NULL — they keep inline creds)

POST /api/vcs-installations/:id/repos
  → list repos accessible to this installation (same as today's /api/github-app/repos)
  → body: {} (creds loaded from DB by id)
  → returns: repos[], installation metadata
```

### Updated: `POST /api/repos`

Accepts either:
- `vcsInstallationId` — looks up creds from `vcs_installations`, copies to repo row
- Raw `githubAppId + githubAppPrivateKey + githubAppInstallationId` — as today (backward compat)

---

## UI Changes

### Connect.tsx — new structure

```
[Platform tabs: GitHub | Azure DevOps | GitLab* | Bitbucket*]
  * grayed out with "coming soon" badge

─── GitHub selected ───────────────────────────────────────────

Saved App Installations:
┌─────────────────────────────────────────────────┐
│ ✓ theashishmaurya  User  App #3015655           │  [✕]
│   [Select repository…  ▾ ]  Branch: [master  ] │
│                       [Connect Repository →]    │
└─────────────────────────────────────────────────┘

[+ Add GitHub App installation]

── or ──────────────────────────────────────────────

[Use Personal Access Token instead]
  Token: [____________]
  Repo URL: [__________]
  Branch: [main]
  [Connect Repository →]
```

### Ready.tsx — smart skip

- On mount: check `repos.github_app_installation_id IS NOT NULL` (from GET /api/repos/:id)
- If set → skip wizard, show "Bot identity active" banner + go-to-dashboard link
- If not set → show 4-step wizard as before
- After step 3 API call succeeds → persist in localStorage + update UI immediately

### Settings > Connections [future page]

- List all `vcs_installations` for the org
- Add / remove installations
- Edit display name
- Show which repos use each installation

---

## File Change Summary

| File | Change |
|---|---|
| `packages/api/src/index.ts` | Add `vcs_installations` table + FK on `repos` |
| `packages/api/src/routes/repos.ts` | New VCS installation routes; `POST /api/repos` accepts `vcsInstallationId` |
| `packages/dashboard/src/pages/Connect.tsx` | Installation card flow; inline add-installation form; PAT as fallback |
| `packages/dashboard/src/pages/Ready.tsx` | Skip wizard if installation already linked to repo |

---

## Iteration Plan

| Iteration | Scope |
|---|---|
| **1 (this PR)** | GitHub App installations — save, list, pick repo, connect |
| **2** | Azure Entra ID app registration — same card pattern, OAuth callback |
| **3** | GitLab OAuth app |
| **4** | Bitbucket OAuth consumer |
| **5** | Settings > Connections management page |

---

## Not In Scope (yet)

- Installing the GitHub App via OAuth redirect (GitHub App flow `/app/installations/new`)
- Rotating PEM keys on existing installations
- Per-repo override of installation credentials
- Audit log of which installation was used for which review
