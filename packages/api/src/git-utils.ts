import { createAppAuth } from '@octokit/auth-app'

/**
 * Resolve a Git clone token — either a fresh GitHub App installation token
 * (generated on the fly, valid for 1 hour) or a plain PAT.
 *
 * Call this immediately before every git clone / git fetch to ensure the token
 * is always fresh. GitHub App installation tokens expire after 1 hour, so
 * re-using a token from the initial clone will fail after the first hour.
 */
export async function resolveCloneToken(
  appId?: string | null,
  privateKey?: string | null,
  installationId?: string | null,
  pat?: string | null,
): Promise<string | null> {
  if (appId && privateKey && installationId) {
    try {
      const auth = createAppAuth({ appId, privateKey, installationId: Number(installationId) })
      const result = await auth({ type: 'installation' }) as { token: string }
      return result.token
    } catch (err) {
      console.error('[git-utils] Failed to generate GitHub App installation token:', (err as Error).message)
      // Fall back to PAT if available
    }
  }
  return pat ?? null
}

/** Build an authenticated clone URL by embedding a token as a password */
export function buildAuthenticatedUrl(repoUrl: string, token: string | null): string {
  if (!token) return repoUrl
  try {
    const url = new URL(repoUrl)
    if (repoUrl.includes('dev.azure.com')) {
      url.username = 'oauth2'
      url.password = token
    } else {
      // GitHub / GitLab / others: x-access-token works for both PATs and installation tokens
      url.username = 'x-access-token'
      url.password = token
    }
    return url.toString()
  } catch {
    return repoUrl
  }
}
