/**
 * Azure DevOps OAuth 2.0 token management.
 * Handles getting and refreshing Entra ID access tokens for Azure DevOps API calls.
 */
import type { Pool } from 'pg'

const AZURE_DEVOPS_SCOPE = 'https://app.vssps.visualstudio.com/user_impersonation offline_access'

interface AzureInstRow {
  azure_client_id: string
  azure_client_secret: string
  azure_tenant_id: string
  azure_access_token: string | null
  azure_refresh_token: string | null
  azure_token_expires_at: string | null
}

async function refreshToken(pool: Pool, instId: string, inst: AzureInstRow): Promise<string> {
  if (!inst.azure_refresh_token) throw new Error('No refresh token available — re-authorize the Azure connection')
  const res = await fetch(`https://login.microsoftonline.com/${inst.azure_tenant_id}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: inst.azure_client_id,
      client_secret: inst.azure_client_secret,
      grant_type: 'refresh_token',
      refresh_token: inst.azure_refresh_token,
      scope: AZURE_DEVOPS_SCOPE,
    }).toString(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Azure token refresh failed (${res.status}): ${body}`)
  }
  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  await pool.query(
    `UPDATE vcs_installations
     SET azure_access_token = $1,
         azure_refresh_token = COALESCE($2, azure_refresh_token),
         azure_token_expires_at = $3
     WHERE id = $4`,
    [data.access_token, data.refresh_token ?? null, expiresAt, instId],
  )
  return data.access_token
}

/**
 * Returns a valid Azure DevOps Bearer token for the given VCS installation.
 * Auto-refreshes the token if it is expired or expiring within 5 minutes.
 * Throws if the installation has not yet been authorized via OAuth.
 */
export async function getAzureOAuthToken(pool: Pool, instId: string): Promise<string> {
  const { rows } = await pool.query<AzureInstRow>(
    `SELECT azure_client_id, azure_client_secret, azure_tenant_id,
            azure_access_token, azure_refresh_token, azure_token_expires_at
     FROM vcs_installations WHERE id = $1`,
    [instId],
  )
  const inst = rows[0]
  if (!inst) throw new Error('Azure VCS installation not found')
  if (!inst.azure_access_token) {
    throw new Error('Azure DevOps not yet authorized. Complete the OAuth flow in the Connect page.')
  }
  // Refresh if expiring within 5 minutes
  if (!inst.azure_token_expires_at || new Date(inst.azure_token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    return refreshToken(pool, instId, inst)
  }
  return inst.azure_access_token
}

/**
 * Build the Microsoft authorization URL to initiate the OAuth flow.
 */
export function buildAzureAuthUrl(params: {
  clientId: string
  tenantId: string
  redirectUri: string
  state: string
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    response_type: 'code',
    redirect_uri: params.redirectUri,
    scope: AZURE_DEVOPS_SCOPE,
    state: params.state,
    response_mode: 'query',
    prompt: 'select_account',
  })
  return `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/authorize?${query}`
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeAzureCode(params: {
  code: string
  clientId: string
  clientSecret: string
  tenantId: string
  redirectUri: string
}): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const res = await fetch(`https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      scope: AZURE_DEVOPS_SCOPE,
    }).toString(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${body}`)
  }
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }
}
