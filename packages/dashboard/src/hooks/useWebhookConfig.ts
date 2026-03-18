import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useAuth } from './useAuth'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

/**
 * Manages webhook URL construction, secret reveal/copy, and secret rotation
 * for the active org and selected platform.
 */
export function useWebhookConfig(platform: 'github' | 'azure') {
  const { user } = useAuth()

  const activeOrgSlug =
    (user?.orgs?.find(
      (o: { orgId: string; slug: string }) => o.orgId === user.activeOrgId,
    ) ?? user?.orgs?.[0])?.slug

  const webhookPath =
    platform === 'azure'
      ? activeOrgSlug ? `/api/webhooks/azure/${activeOrgSlug}` : '/api/webhooks/azure'
      : activeOrgSlug ? `/api/webhooks/github/${activeOrgSlug}` : '/api/webhooks/github'

  const webhookUrl = `${window.location.origin}${webhookPath}`
  const redirectUri = `${window.location.origin}/api/ado/oauth/callback`

  const { data: webhookData, mutate: mutateWebhooks } = useSWR<{
    webhooks: Array<{ platform: string; secretPreview: string }>
  }>(activeOrgSlug ? `/api/orgs/${activeOrgSlug}/webhooks` : null, fetcher)

  const secretPreview = webhookData?.webhooks?.find(w => w.platform === platform)?.secretPreview

  const [webhookCopied, setWebhookCopied] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)
  const [rotating, setRotating] = useState(false)

  // Reset revealed secret when platform changes
  useEffect(() => { setRevealedSecret(null) }, [platform])

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl)
    setWebhookCopied(true)
    setTimeout(() => setWebhookCopied(false), 2000)
  }

  function copySecret(val: string) {
    navigator.clipboard.writeText(val)
    setSecretCopied(true)
    setTimeout(() => setSecretCopied(false), 2000)
  }

  async function rotateSecret() {
    if (!activeOrgSlug) return
    setRotating(true)
    try {
      const res = await fetch(`/api/orgs/${activeOrgSlug}/webhooks/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ platform }),
      })
      const data = await res.json() as { secret?: string }
      if (data.secret) {
        setRevealedSecret(data.secret)
        mutateWebhooks()
      }
    } finally {
      setRotating(false)
    }
  }

  return {
    webhookUrl,
    redirectUri,
    secretPreview,
    revealedSecret,
    webhookCopied,
    secretCopied,
    rotating,
    activeOrgSlug,
    copyWebhook,
    copySecret,
    rotateSecret,
  }
}
