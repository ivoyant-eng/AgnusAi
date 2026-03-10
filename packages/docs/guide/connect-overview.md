# Connecting Repositories

Ryv supports two VCS platforms and two authentication methods per platform. This page explains how the **Connect** page works and when to use each approach.

---

## How it works

The **Connect** page (Dashboard → Connect) has two sections inside an accordion:

| Section | Use when |
|---------|----------|
| **App Installation / Azure Connection** | Team deployments — reviews post as a dedicated bot account |
| **Personal Access Token** | Quick setup, personal use, or platforms without App auth |

Opening one section closes the other. Choose **App Installation** unless you're just trying things out.

---

## Saved connections

App credentials are saved as a **VCS Installation** (GitHub) or **Connection** (Azure DevOps). Once saved:

- You can pick any accessible repo from a searchable dropdown
- Multiple orgs or accounts each get their own card
- Connections persist across sessions — you never re-enter credentials

---

## Platform guides

| Platform | Recommended method | Guide |
|----------|--------------------|-------|
| GitHub | GitHub App | [GitHub App →](./github-app) |
| Azure DevOps | Entra ID OAuth | [Azure DevOps →](./azure-devops) |

PAT-based setup is the same for both platforms and is covered at the bottom of each guide.

---

## Webhook setup

Every platform requires a **webhook** so Ryv is notified when pull requests are opened or updated.

The left-hand panel on the Connect page shows:
- The exact **Webhook URL** to register (copy button included)
- The **Webhook Secret** (generate or rotate on demand)
- The required **event types** to subscribe to
- For Azure: the **Entra App Redirect URI** to register in Azure Portal

::: tip Org slug in the URL
The webhook URL contains your org slug (e.g. `.../api/webhooks/github/my-org`). For single-tenant installs the slug is `default`. The dashboard pre-fills the correct URL.
:::
