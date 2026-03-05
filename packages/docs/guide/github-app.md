# GitHub App Auth

By default Ryv uses a **Personal Access Token (PAT)** to post review comments. That works fine for individual use, but for team deployments a **GitHub App** is the recommended approach:

- Reviews post as a named bot identity (e.g. `ryv-bot[bot]`) instead of a personal account
- No expiry — App auth uses short-lived installation tokens refreshed automatically
- Fine-grained permissions per repo, not account-wide
- Approved by GitHub for org-level integrations

::: tip Backward compatible
Existing PAT-based repos continue to work unchanged. Switching to App auth is optional and per-repo.
:::

---

## 1. Create the GitHub App

Go to your GitHub organization or personal settings and create a new App.

- **Org-level:** `https://github.com/organizations/YOUR_ORG/settings/apps/new`
- **Personal:** `https://github.com/settings/apps/new`

Fill in these values:

| Field | Value |
|-------|-------|
| App name | `Ryv` (or any name you like) |
| Homepage URL | Your Ryv instance URL, e.g. `https://ryv.example.com` |
| Webhook URL | `https://ryv.example.com/api/webhooks/github/YOUR_ORG_SLUG` |
| Webhook secret | The value from **Settings → Webhook Secrets → GitHub** in the dashboard |

### Required permissions

| Permission | Access |
|-----------|--------|
| Contents | Read & Write |
| Pull requests | Read & Write |
| Issues | Read & Write |
| Checks | Read-only |
| Metadata | Read-only (mandatory) |

### Subscribe to events

Check **Pull request** under _Subscribe to events_.

Hit **Create GitHub App**.

---

## 2. Generate a private key

On the App's settings page, scroll down to **Private keys** → **Generate a private key**.

A `.pem` file downloads to your machine — keep it safe, you'll paste its contents into Ryv in the next step.

Also note the **App ID** shown at the top of the App settings page (a plain integer, e.g. `1234567`).

---

## 3. Install the App on your repository

On the App settings page, click **Install App** in the left sidebar.

- Choose your account or organization
- Select **Only select repositories** and add the repo you want Ryv to review
- Click **Install**

The URL after installation looks like:

```
https://github.com/settings/installations/78901234
```

That number (`78901234`) is your **Installation ID**.

---

## 4. Connect in Ryv

### Via the dashboard

1. Go to **Connect a Repository**
2. Set **Platform** to `GitHub`
3. Click the **GitHub App** toggle (next to "Personal Access Token")
4. Enter:
   - **App ID** — the integer from the App settings page
   - **Private Key** — paste the full `.pem` file contents
   - **Installation ID** — from the installation URL
5. Fill in the repo URL and branches, then submit

### Via the API

If the repo is already registered, you can add App credentials without re-registering:

```bash
curl -b /tmp/agnus.txt -X POST https://your-server.com/api/repos/<repoId>/github-app \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "1234567",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
    "installationId": "78901234"
  }'
```

Returns `{ "ok": true, "repoId": "...", "githubAppId": "...", "githubAppInstallationId": "..." }`.

When registering a new repo with App credentials from the start:

```bash
curl -b /tmp/agnus.txt -X POST https://your-server.com/api/repos \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "platform": "github",
    "branches": ["main"],
    "githubAppId": "1234567",
    "githubAppPrivateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
    "githubAppInstallationId": "78901234"
  }'
```

---

## 5. Verify

Open a pull request on the connected repo. Review comments will now appear from your GitHub App bot identity (e.g. `ryv-bot[bot]`) rather than a personal account.

::: tip Find your org slug
Your org slug appears in the dashboard URL and in **Settings → Organization**. For single-tenant installs it is `default`, giving a webhook URL of `.../api/webhooks/github/default`. The **Ready** page in the dashboard pre-fills the correct URL for your org automatically.
:::

---

## PAT vs GitHub App — quick comparison

| | PAT | GitHub App |
|-|-----|------------|
| Comments posted as | Your personal account | `your-app[bot]` |
| Token expiry | Never (classic) or configurable | Auto-refreshed, no action needed |
| Permissions | Account-wide | Per-installation, per-repo |
| Org approval required | No | Recommended for org deployments |
| Revocation | Delete the token | Uninstall the App |

---

## Troubleshooting

**`GitHub token or App credentials required for review`**
The repo has neither a PAT nor complete App credentials (App ID + private key + installation ID). Add them via the dashboard or `POST /api/repos/:id/github-app`.

**`signature verification failed` on webhook**
The webhook secret in GitHub App settings doesn't match the secret stored in Ryv. Rotate the secret via **Settings → Webhook Secrets → Rotate** and update it in the GitHub App settings. Also double-check the webhook URL includes the org slug: `.../api/webhooks/github/YOUR_ORG_SLUG`.

**`Bad credentials` from Octokit**
Check that the private key is the complete `.pem` including the `-----BEGIN/END-----` lines. Multi-line keys must have `\n` newlines preserved — pasting into the dashboard textarea handles this automatically.

**Reviews still posting as my personal account**
The repo's `github_app_id` column may not be set. Check with:
```bash
GET /api/repos   # returns githubAppId and githubAppInstallationId per repo
```
If null, re-submit credentials via `POST /api/repos/:id/github-app`.
