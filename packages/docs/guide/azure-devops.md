# Azure DevOps — Connection Setup

Ryv supports two authentication methods for Azure DevOps:

| Method | Best for |
|--------|----------|
| **Entra ID OAuth** (recommended) | Team deployments — reviews post as a dedicated service/bot account |
| **Personal Access Token (PAT)** | Quick personal setup |

::: tip Bot account recommended
For Entra ID OAuth, authorize the app using a **dedicated service account** (e.g. `ryv-bot@yourcompany.com`), not your personal account. That way review comments appear from a bot identity, not your name.
:::

---

## Method 1 — Entra ID OAuth (recommended)

### Step 1 — Register an app in Azure Portal

1. Sign in to [portal.azure.com](https://portal.azure.com) as an admin
2. Go to **Microsoft Entra ID → App registrations → New registration**
3. Fill in:
   - **Name:** `Ryv` (or any name)
   - **Supported account types:** Accounts in this organizational directory only
   - **Redirect URI:** Leave blank for now — you'll fill this in a moment

Click **Register**.

---

### Step 2 — Add the redirect URI

After registration:

1. In your new app, go to **Authentication → Add a platform → Web**
2. For the **Redirect URI**, copy the value from the **Connect page webhook panel**:

   > The left column of the Connect page shows the redirect URI under **Entra App → Redirect URI** when Azure is selected. It looks like:
   > `https://your-ryv-instance.example.com/api/ado/oauth/callback`

3. Click **Add** → **Save**

---

### Step 3 — Add the Azure DevOps API permission

1. Go to **API permissions → Add a permission → APIs my organization uses**
2. Search for **Azure DevOps** → select it
3. Select **Delegated permissions** → check `user_impersonation`
4. Click **Add permissions**

If your tenant requires it, click **Grant admin consent**.

---

### Step 4 — Create a client secret

1. Go to **Certificates & secrets → New client secret**
2. Add a description (e.g. `Ryv`) and choose an expiry
3. Copy the **Value** immediately — it won't be shown again

Also note your app's:
- **Application (Client) ID** — from the app overview page
- **Directory (Tenant) ID** — from the app overview page

---

### Step 5 — Create a service account in Azure DevOps

1. Create a new Microsoft account dedicated to Ryv reviews (e.g. `ryv-bot@yourcompany.com`)
2. Add this account to your Azure DevOps organization at `https://dev.azure.com/YOUR_ORG/_settings/users`
3. Grant it at minimum: **Contributor** access to the projects you want Ryv to review

::: info Why a service account?
When you complete the OAuth flow in Step 6, you'll sign in with this account. All review comments will be posted under its identity. Using a service account keeps reviews clearly attributed to Ryv rather than a person.
:::

---

### Step 6 — Add the connection in Ryv

1. Open **Dashboard → Connect a Repository**
2. Select **Platform: Azure DevOps**
3. In the **Azure DevOps Connection** accordion, click **+ Add**
4. Fill in:
   - **Organization URL** — `https://dev.azure.com/YOUR_ORG`
   - **Application (Client) ID** — from Step 4
   - **Directory (Tenant) ID** — from Step 4
   - **Client Secret** — the value from Step 4
   - **Label** _(optional)_ — e.g. `ivoyant org`
5. Click **Save & Authorize**

A Microsoft sign-in window opens. **Sign in with the service account** you created in Step 5 (not your personal account).

After signing in and granting consent, you'll be redirected back to the Connect page with a **"Azure DevOps connected"** confirmation.

---

### Step 7 — Connect a repository

In the connection card (now showing **connected** badge):

1. Click **Select a repository…** and search for the repo
2. Enter the **branch** to index (e.g. `main`, `develop`)
3. Click **Connect →**

---

### Step 8 — Set up the webhook in Azure DevOps

1. Go to your Azure DevOps project → **Project Settings → Service Hooks → Create subscription**
2. Select **Web Hooks**
3. Subscribe to these events separately:
   - `git.pullrequest.created`
   - `git.pullrequest.updated`
   - `git.push` _(optional — for branch indexing)_
4. For each subscription, set:
   - **URL:** The webhook URL from the Connect page (e.g. `https://your-instance.com/api/webhooks/azure/YOUR_ORG_SLUG`)
   - **HTTP headers:** `X-Webhook-Secret: YOUR_SECRET` — copy the secret from the Connect page

---

### Token refresh

OAuth tokens expire after ~1 hour. Ryv auto-refreshes them using the stored refresh token — no action needed. If the refresh token also expires (after ~90 days of inactivity), the connection card will show **auth required** and you'll need to click **Authorize with Microsoft →** again.

---

## Method 2 — Personal Access Token

For quick setup without Entra ID registration:

1. In Azure DevOps, go to **User settings → Personal access tokens → New token**
2. Set:
   - **Name:** `Ryv`
   - **Expiration:** as needed
   - **Scopes:** Code (Read & Write), Pull Request Threads (Read & Write)
3. Copy the token value

Then in the Ryv Connect page:

1. Select **Platform: Azure DevOps**
2. Open the **Personal Access Token** accordion
3. Fill in:
   - **Repository URL:** `https://dev.azure.com/org/project/_git/repo`
   - **Access Token:** your PAT
   - **Branches:** comma-separated (e.g. `main, develop`)
4. Click **Connect Repository →**

::: warning PAT limitations
Reviews post as your personal Azure DevOps account. PATs expire and must be manually rotated. For team use, prefer the Entra ID method above.
:::

---

## Entra ID OAuth vs PAT — comparison

| | PAT | Entra ID OAuth |
|-|-----|----------------|
| Comments posted as | Your personal account | Service/bot account |
| Token expiry | Manual rotation needed | Auto-refreshed |
| Setup complexity | Low | Medium (one-time) |
| Suitable for teams | No | Yes |
| Revocation | Delete the PAT | Revoke Entra app consent |

---

## Troubleshooting

**`AADSTS50011` — redirect URI mismatch**
The redirect URI registered in Azure Portal doesn't exactly match the one shown on the Connect page. Copy the URI from the Connect page's webhook panel (under **Entra App → Redirect URI**) and register it as a **Web** redirect URI in Azure Portal → Authentication.

**`AADSTS650052` — no Azure DevOps subscription**
Your Entra tenant doesn't have an Azure DevOps service principal. This typically means the Azure DevOps organization is linked to a different tenant. Make sure you're using the correct Tenant ID and that your Azure DevOps organization is connected to the same Entra directory.

**`auth required` badge persists after authorizing**
Refresh the Connect page. If still showing, click **Authorize with Microsoft →** again and complete the full sign-in flow. Ensure you sign in with the service account that has Azure DevOps access.

**Reviews posting as a personal account**
You signed in with your personal Microsoft account during the OAuth flow. Click the **auth required** badge card's **Authorize with Microsoft →** button, sign out of the current Microsoft session, then sign in with the dedicated service account.

**No repos in the dropdown after connecting**
The service account may not have access to the project. Add it to the Azure DevOps organization and grant it at least **Contributor** access to the relevant project, then click **Refresh list**.

**`Clone/pull failed` during indexing**
The repo URL or credentials may be incorrect. For PAT repos, verify the PAT has **Code: Read** scope. For OAuth repos, ensure the service account has repository access. Check the token hasn't expired in the Azure Portal.
