# Plan: Multi-Organization Support

> **Priority:** Phase 1 — Foundation (Unblocks Enterprise)
> **Effort:** Large (2–3 sprints)
> **Roadmap ref:** `docs/roadmap/v3-competitive.md#G5`
> **Research:** Qodo's multi-org architecture studied February 2026

---

## Problem Statement

AgnusAI today is effectively single-tenant:
- One admin seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables
- Invite-only registration — no public signup
- Invites are system-level, not scoped to any organization
- Repos, API keys, review history are all globally shared
- One global webhook endpoint per VCS (`/api/webhooks/github`, `/api/webhooks/azure`)
- No concept of organization, workspace, or tenant

This blocks any team with multiple business units, subsidiaries, or separate product teams. It also means one compromised invite gives access to everything.

---

## What We're NOT Doing (Lessons from Qodo)

Qodo's research shows:
- Qodo on-prem has NO per-org user management — they fully delegate to the VCS platform
- Qodo uses a single webhook secret for all GitHub orgs — the GitHub App's `installation_id` disambiguates orgs
- Qodo on-prem has no native multi-ADO-org support in a single deployment — it is a known gap

**AgnusAI will do better:**
- Full organization entity with per-org isolation in our own DB
- Per-org webhook signing secrets (not a single global secret)
- Self-service signup + org creation
- Org-scoped invites and user management
- Org-scoped repos, API keys, review history, and rules

---

## Target Model

```
Deployment (one AgnusAI instance)
└── Organization A (e.g. Acme Corp)
│   ├── Members: alice (admin), bob (member)
│   ├── Repos: repo1, repo2
│   ├── Webhook: /api/webhooks/github/{orgSlug}
│   ├── API Keys: org-scoped keys
│   └── Rules: org-scoped rules
└── Organization B (e.g. Startup Inc)
    ├── Members: charlie (admin)
    ├── Repos: repo3
    ├── Webhook: /api/webhooks/github/{orgSlug}
    └── Rules: org-scoped rules
```

System admin (seeded from env vars) has cross-org visibility but does NOT appear in any org's member list unless explicitly added.

---

## Database Schema Changes

### New table: `organizations`

```sql
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,    -- URL-safe, e.g. 'acme-corp'
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'team' | 'enterprise'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orgs_slug ON organizations(slug);
```

### New table: `org_members`

```sql
CREATE TYPE org_role AS ENUM ('admin', 'member');

CREATE TABLE org_members (
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        org_role NOT NULL DEFAULT 'member',
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
```

### Modify: `users`

Remove the current `role` column's global admin semantics. Add a `is_system_admin` boolean:

```sql
ALTER TABLE users ADD COLUMN is_system_admin BOOLEAN NOT NULL DEFAULT false;
```

The `ADMIN_EMAIL` bootstrap flow sets `is_system_admin = true` on that user.

### Modify: `repos`

```sql
ALTER TABLE repos ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX idx_repos_org ON repos(org_id);
```

### New table: `org_webhook_secrets`

```sql
CREATE TABLE org_webhook_secrets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,    -- 'github' | 'azure' | 'gitlab'
  secret      TEXT NOT NULL,    -- HMAC signing secret (stored encrypted)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, platform)
);
```

### Modify: `invite_tokens`

```sql
ALTER TABLE invite_tokens ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE invite_tokens ADD COLUMN org_role org_role NOT NULL DEFAULT 'member';
-- org_id = NULL means system-level invite (system admin only, rare)
```

### Modify: `system_api_keys`

```sql
ALTER TABLE system_api_keys ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
-- org_id = NULL means system-scoped key (system admin only)
CREATE INDEX idx_api_keys_org ON system_api_keys(org_id);
```

---

## Auth & Middleware Changes (`packages/api/src/routes/auth.ts`)

### Signup flow (new — currently invite-only)

New endpoint: `POST /api/auth/signup`

```typescript
// Request body
interface SignupRequest {
  email: string;
  password: string;
  orgName: string;    // Creates a new org for the user
  orgSlug: string;    // URL-safe slug, validated unique
}

// Flow:
// 1. Validate email not already registered
// 2. Validate orgSlug not already taken
// 3. Create user (no is_system_admin)
// 4. Create organization
// 5. Add user to org_members as 'admin'
// 6. Auto-generate org webhook secrets for github + azure
// 7. Set JWT cookie, return user + org
```

This is a public endpoint — no invite required. Rate-limited (10 signups/IP/hour).

### Invite flow (scoped to org)

Modified: `POST /api/auth/invite`

Only org admins can create invites (for their own org). System admin can create invites for any org.

```typescript
interface InviteRequest {
  email: string;
  orgId: string;           // which org to invite to
  role: 'admin' | 'member';
}
// Creates invite_token with org_id + org_role set
// Sends invite email with link: /accept-invite?token=xxx
```

New: `POST /api/auth/accept-invite`

```typescript
// If user already has an account: add them to the org as specified role
// If user is new: create account first, then add to org
// Either way: log them in and redirect to /dashboard
```

### JWT claims update

Add `orgId` + `orgRole` to the JWT payload (or a separate session lookup). The middleware needs to know which org the current request is for.

For multi-org users (one person in multiple orgs), use an `X-Org-Slug` header or URL path prefix to select the active org context.

```typescript
// Fastify request decoration
interface RequestUser {
  userId: string;
  email: string;
  isSystemAdmin: boolean;
  activeOrgId: string;         // resolved from X-Org-Slug or URL param
  activeOrgRole: 'admin' | 'member';
}
```

### New middleware: `requireOrgAdmin`

```typescript
export async function requireOrgAdmin(req, reply) {
  if (!req.user.isSystemAdmin && req.user.activeOrgRole !== 'admin') {
    return reply.status(403).send({ error: 'org admin required' });
  }
}
```

---

## Webhook Architecture Changes (`packages/api/src/routes/webhooks.ts`)

### Current (broken for multi-org)

```
POST /api/webhooks/github   ← global, one secret for all
POST /api/webhooks/azure    ← global
```

### Target

```
POST /api/webhooks/github/:orgSlug   ← per-org, per-org signing secret
POST /api/webhooks/azure/:orgSlug    ← per-org
```

**Why per-org slug in URL and not a query param or header:** Avoids timing-attack issues when looking up the secret. The org is identified before the HMAC validation step, so we can fetch the correct secret for validation.

### Webhook signature validation (updated)

```typescript
async function validateGithubSignature(
  req: FastifyRequest<{ Params: { orgSlug: string } }>,
  reply: FastifyReply
) {
  const { orgSlug } = req.params;

  // 1. Look up org
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, orgSlug)
  });
  if (!org) return reply.status(404).send({ error: 'org not found' });

  // 2. Fetch org's GitHub webhook secret
  const secretRow = await db.query.orgWebhookSecrets.findFirst({
    where: and(
      eq(orgWebhookSecrets.orgId, org.id),
      eq(orgWebhookSecrets.platform, 'github')
    )
  });
  if (!secretRow) return reply.status(403).send({ error: 'webhook not configured' });

  // 3. Validate HMAC-SHA256
  const signature = req.headers['x-hub-signature-256'] as string;
  const body = (req as any).rawBody;
  const expected = `sha256=${createHmac('sha256', secretRow.secret).update(body).digest('hex')}`;

  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return reply.status(401).send({ error: 'invalid signature' });
  }

  // 4. Attach org to request
  (req as any).org = org;
}
```

### Per-org webhook setup UI

When a user connects a GitHub/Azure repo in the dashboard, the onboarding flow shows them:

```
Your GitHub webhook URL:
  https://your-agnus-instance.com/api/webhooks/github/acme-corp

Your webhook secret (copy this — shown once):
  whsec_abc123...

Events to subscribe: pull_request, pull_request_review, issue_comment
```

The secret is auto-generated on org creation and can be rotated from Settings > Webhooks.

---

## API Route Changes

All existing routes get org-scoped versions. URL pattern: `/api/orgs/:orgSlug/...` (preferred) or resolving org from auth context.

### Current → Target route mapping

| Current | Target |
|---|---|
| `GET /api/repos` | `GET /api/repos` (filtered to active org via auth context) |
| `POST /api/repos` | `POST /api/repos` (org_id from auth context) |
| `GET /api/repos/:id` | Same, but verify repo.org_id matches active org |
| `POST /api/repos/:id/review` | Same |
| `GET /api/repos/:id/index/status` | Same |

New org management routes:

```
GET    /api/orgs/me                        Current user's orgs
POST   /api/orgs                           Create new org (system admin only or via signup)
GET    /api/orgs/:orgSlug                  Org detail
PUT    /api/orgs/:orgSlug                  Update org name/settings
DELETE /api/orgs/:orgSlug                  Delete org (system admin only)

GET    /api/orgs/:orgSlug/members          List members
POST   /api/orgs/:orgSlug/members          Add existing user to org
DELETE /api/orgs/:orgSlug/members/:userId  Remove member
PATCH  /api/orgs/:orgSlug/members/:userId  Change role

POST   /api/orgs/:orgSlug/invites          Create org-scoped invite
GET    /api/orgs/:orgSlug/invites          List pending invites

GET    /api/orgs/:orgSlug/webhooks         List webhook configs
POST   /api/orgs/:orgSlug/webhooks/rotate  Rotate webhook secret
```

---

## Dashboard Changes (`packages/dashboard/`)

### New pages

```
/signup                        Public signup — email + password + org name
/accept-invite                 Invite acceptance (new or existing user)
/org/switch                    Switch active org (for multi-org users)
/settings/org                  Org settings — name, members, webhooks
/settings/org/members          Member management (invite, role change, remove)
/settings/org/webhooks         Webhook URLs + secrets + rotation
/settings/org/api-keys         Org-scoped API keys
```

### Updated pages

- **`/connect` (repo connect)** — add org context, show org-specific webhook URL instead of global
- **`/settings`** — split into personal settings vs org settings
- **Nav header** — add org switcher dropdown if user is in multiple orgs

### Org switcher

```
┌─────────────────────────────┐
│ Acme Corp          ▾        │
├─────────────────────────────┤
│ ✓ Acme Corp                 │
│   Startup Inc               │
│ ─────────────────────────── │
│ + Create new org            │
└─────────────────────────────┘
```

Selecting an org updates the `X-Org-Slug` header on all subsequent API calls (stored in `localStorage` or a React context).

---

## Onboarding Flow (New User)

This is the onboarding Qodo does NOT have for self-hosted — we can own this:

```
1. /signup
   ├── Enter email, password
   ├── Choose org name (auto-suggests slug)
   └── Submit → creates user + org + webhook secrets

2. /onboarding/connect
   ├── "Connect your first repo"
   ├── Enter GitHub/Azure repo URL + PAT or OAuth
   └── Shows YOUR org's webhook URL + secret to configure

3. /onboarding/indexing
   ├── Live SSE progress: parsing → graph → embeddings
   └── "Your codebase is being indexed..."

4. /onboarding/ready
   ├── Stats: X symbols indexed, Y files, Z dependencies
   ├── Copy webhook URL + secret (remindable later in settings)
   └── "Open a PR to see AgnusAI in action"
```

### Invite flow (existing user inviting a teammate)

```
Settings > Members > Invite teammate
  Enter email → role (admin/member) → Send invite

Teammate receives email:
  "Alice has invited you to join Acme Corp on AgnusAI"
  [Accept Invite] → /accept-invite?token=xxx

  If no account: fills in password → account created → added to org
  If has account: click accept → added to org → redirected to /dashboard
```

---

## Security Considerations

1. **Per-org webhook secrets** — generated with `crypto.randomBytes(32).toString('hex')`, stored encrypted (AES-256 with `SECRET_KEY` env var), shown once on generation
2. **Org isolation** — every DB query that returns repos/reviews/rules must filter by `org_id`. Add a middleware check that attaches `req.user.activeOrgId` and use it as a mandatory filter in all handlers.
3. **Invite tokens** — single-use, expire in 7 days, scoped to an org + email (can't transfer to a different email)
4. **Cross-org access** — system admin can set `X-Org-Slug` header to operate in any org. Regular users cannot access repos/reviews outside their orgs.
5. **Rate limiting** — signup endpoint: 10 per IP per hour. Invite creation: 50 per org per day.

---

## Migration: Existing Single-Tenant Installations

For users already running AgnusAI (pre-multi-org), a migration script:

```typescript
// packages/api/src/migrations/add-multi-org.ts

// 1. Create a default organization named from env var DEFAULT_ORG_NAME
//    (fallback: 'Default Organization', slug: 'default')
// 2. Move all existing repos to this org
// 3. Move all existing users to this org (admin user as org admin)
// 4. Generate webhook secrets for each platform
// 5. Update all review_feedback, review_comments, api_keys etc. with org_id
```

Webhook URLs change from `/api/webhooks/github` → `/api/webhooks/github/default`.
Display a migration banner in the dashboard until the user updates their webhook config.

---

## Build Order

1. **DB migrations** — `organizations`, `org_members`, `org_webhook_secrets`, alter existing tables
2. **Auth changes** — signup endpoint, scoped invites, JWT claims update
3. **Middleware** — `requireOrgAdmin`, org-from-request resolution
4. **Webhook routing** — per-org webhook endpoints + HMAC validation
5. **Route filtering** — ensure all data queries filter by org_id
6. **Dashboard: Signup page** — public signup with org creation
7. **Dashboard: Org settings + member management** — invite, role change, remove
8. **Dashboard: Webhook settings** — show URLs + rotate secrets
9. **Dashboard: Org switcher** — for multi-org users
10. **Migration script** — safe upgrade path for existing installations
11. **Updated onboarding flow** — reflect per-org webhook URLs

---

## Out of Scope (This Plan)

- Cross-org repo sharing
- Per-org LLM provider overrides (use system-level LLM for all orgs)
- Org-level billing / seat management
- SAML/SSO per org
- Organization audit logs (separate plan)
