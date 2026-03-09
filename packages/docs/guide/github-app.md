# GitHub — App Installation

By default Ryv uses a **Personal Access Token (PAT)** to post review comments. That works fine for personal use, but for team deployments a **GitHub App** is the recommended approach:

- Reviews post as a named bot identity (e.g. `ryv-bot[bot]`) instead of a personal account
- No token expiry — App auth uses short-lived installation tokens refreshed automatically
- Fine-grained permissions per repo, not account-wide
- Approved by GitHub for org-level integrations

::: tip Backward compatible
Existing PAT-based repos continue to work unchanged. Switching to App auth is optional and per-repo.
:::

---

## Step 1 — Create the GitHub App

Go to your GitHub organization or personal settings and create a new App.

- **Org-level:** `https://github.com/organizations/YOUR_ORG/settings/apps/new`
- **Personal:** `https://github.com/settings/apps/new`

Fill in these values:

| Field | Value |
|-------|-------|
| App name | `Ryv` (or any name you like) |
| Homepage URL | Your Ryv instance URL, e.g. `https://ryv.example.com` |
| Webhook URL | Shown in the **Connect page → webhook config panel** — copy from there |
| Webhook secret | The value from the **Connect page → Generate secret** button |

### Required permissions

| Permission | Access |
|-----------|--------|
| Contents | Read & Write |
| Pull requests | Read & Write |
| Issues | Read & Write |
| Checks | Read-only |
| Metadata | Read-only (mandatory) |

### Events to subscribe

Check **Pull request** and **Push** under _Subscribe to events_.

Click **Create GitHub App**.

---

## Step 2 — Generate a private key

On the App's settings page, scroll to **Private keys** → **Generate a private key**.

A `.pem` file downloads — keep it safe, you'll paste it into Ryv next.

Also note the **App ID** shown at the top of the page (an integer, e.g. `1234567`).

---

## Step 3 — Install the App on your repository

On the App settings page, click **Install App** in the left sidebar.

- Choose your account or organization
- Select **Only select repositories** and add the repos you want Ryv to review
- Click **Install**

The URL after installation ends with your **Installation ID**:

```
https://github.com/settings/installations/78901234
                                           ^^^^^^^^
                                      Installation ID
```

---

## Step 4 — Add the installation in Ryv

1. Open **Dashboard → Connect a Repository**
2. Select **Platform: GitHub**
3. In the **GitHub App Installation** accordion, click **+ Add**
4. Fill in:
   - **App ID** — the integer from Step 2
   - **Private Key** — drag-and-drop or paste the `.pem` file contents
   - **Installation ID** — from the installation URL in Step 3
   - **Label** _(optional)_ — e.g. `ivoyant org` or `personal`
5. Click **Save Installation**

The new installation card appears with a searchable repo dropdown.

---

## Step 5 — Connect a repository

In the installation card:

1. Click **Select a repository…** and search for the repo
2. Enter the **branch** to index (e.g. `main`, `develop`)
3. Click **Connect →**

Ryv starts indexing immediately. You'll be redirected to the indexing progress page.

---

## Step 6 — Verify

Open a pull request on the connected repo. Review comments will appear from your GitHub App bot identity (e.g. `ryv-bot[bot]`) instead of a personal account.

---

## PAT fallback

If you prefer a quick setup without creating a GitHub App, use the **Personal Access Token** accordion on the Connect page.

| Field | Value |
|-------|-------|
| Repository URL | `https://github.com/owner/repo` |
| Access Token | A classic PAT with `repo` scope, or a fine-grained token with Contents + Pull requests read/write |
| Branches | Comma-separated, e.g. `main, develop` |

::: warning PAT limitations
Reviews post as your personal GitHub account. Classic PATs have account-wide access. For team use, prefer the GitHub App method above.
:::

---

## PAT vs GitHub App — comparison

| | PAT | GitHub App |
|-|-----|------------|
| Comments posted as | Your personal account | `your-app[bot]` |
| Token expiry | Never (classic) or configurable | Auto-refreshed every hour |
| Permissions | Account-wide | Per-installation, per-repo |
| Org approval required | No | Recommended for org deployments |
| Revocation | Delete the token | Uninstall the App |

---

## Troubleshooting

**`GitHub token or App credentials required for review`**
The repo has neither a PAT nor complete App credentials. Re-add credentials via the dashboard installation card.

**`signature verification failed` on webhook**
The webhook secret in GitHub App settings doesn't match the secret in Ryv. Click **Rotate & reveal** on the Connect page and update the value in your GitHub App settings.

**`Bad credentials` from Octokit**
The private key may be malformed. Make sure the full `.pem` content including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` lines is included. Use the PEM file drag-and-drop upload to avoid copy-paste issues.

**Reviews still posting as my personal account**
The installation card was not saved correctly, or the repo was connected before the installation existed. Delete and re-connect the repo from the installation card.

**App installed but no repos appear in the dropdown**
Installation is set to **selected repositories** but none were added. Go to `github.com/settings/installations` → click your App → add repos. Then click **Refresh list** in the Ryv card.
