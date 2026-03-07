import { Copy, CheckCircle, RefreshCw } from 'lucide-react'

interface Props {
  platform: 'github' | 'azure'
  webhookUrl: string
  redirectUri: string
  secretPreview: string | undefined
  revealedSecret: string | null
  webhookCopied: boolean
  secretCopied: boolean
  rotating: boolean
  activeOrgSlug: string | undefined
  onCopyWebhook: () => void
  onCopySecret: (val: string) => void
  onRotateSecret: () => void
}

/**
 * Left-column panel showing the webhook URL, optional redirect URI (Azure),
 * webhook secret management, and event subscription hints.
 */
export function WebhookConfigPanel({
  platform,
  webhookUrl,
  redirectUri,
  secretPreview,
  revealedSecret,
  webhookCopied,
  secretCopied,
  rotating,
  activeOrgSlug,
  onCopyWebhook,
  onCopySecret,
  onRotateSecret,
}: Props) {
  return (
    <div className="border border-border">
      <div className="px-4 py-2.5 border-b border-border bg-muted/10 flex items-center justify-between">
        <p className="label-meta" style={{ color: 'var(--lp-accent)' }}>// webhook config</p>
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
          {platform === 'github' ? 'GitHub' : 'Azure DevOps'}
        </p>
      </div>

      <div className="p-4 space-y-4">
        <p className="font-mono text-xs text-muted-foreground">
          {platform === 'github'
            ? 'Repo → Settings → Webhooks → Add webhook'
            : 'Project Settings → Service Hooks → Web Hooks subscription'}
        </p>

        {/* Webhook URL */}
        <CopyRow
          label={platform === 'github' ? 'Payload URL' : 'URL'}
          value={webhookUrl}
          copied={webhookCopied}
          onCopy={onCopyWebhook}
        />

        {/* GitHub: content type hint */}
        {platform === 'github' && (
          <div className="space-y-1.5">
            <p className="label-meta">Content type</p>
            <p className="font-mono text-xs text-foreground">application/json</p>
          </div>
        )}

        {/* Azure: Entra redirect URI */}
        {platform === 'azure' && (
          <div className="space-y-1.5">
            <p className="label-meta">Entra App → Redirect URI</p>
            <CopyRow
              value={redirectUri}
              copied={false}
              onCopy={() => navigator.clipboard.writeText(redirectUri)}
            />
            <p className="label-meta">
              Register this as a <span className="font-mono text-foreground">Web</span> redirect URI
              in Azure Portal → App registrations → Authentication.
            </p>
          </div>
        )}

        {/* Webhook secret */}
        <div className="space-y-1.5">
          <p className="label-meta">
            {platform === 'github' ? 'Secret' : 'X-Webhook-Secret header value'}
          </p>
          {revealedSecret ? (
            <CopyRow
              value={revealedSecret}
              copied={secretCopied}
              onCopy={() => onCopySecret(revealedSecret)}
              mono
            />
          ) : (
            <div className="flex items-center gap-3">
              {secretPreview && (
                <span className="font-mono text-xs text-muted-foreground">{secretPreview}</span>
              )}
              <button
                type="button"
                onClick={onRotateSecret}
                disabled={rotating || !activeOrgSlug}
                className="flex items-center gap-1.5 label-meta hover:text-foreground transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${rotating ? 'animate-spin' : ''}`} />
                {secretPreview ? 'Rotate & reveal' : 'Generate secret'}
              </button>
            </div>
          )}
        </div>

        {/* Event subscriptions */}
        <div className="space-y-1.5 pt-1 border-t border-border">
          <p className="label-meta">{platform === 'github' ? 'Events to subscribe' : 'Event types'}</p>
          <p className="font-mono text-xs text-foreground">
            {platform === 'github'
              ? 'Push  ·  Pull requests'
              : 'git.push  ·  git.pullrequest.created  ·  git.pullrequest.updated'}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Reusable copy-row: value display + copy button */
function CopyRow({
  label,
  value,
  copied,
  onCopy,
  mono = false,
}: {
  label?: string
  value: string
  copied: boolean
  onCopy: () => void
  mono?: boolean
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-meta">{label}</p>}
      <div className="flex items-stretch border border-border">
        <div
          className={`flex-1 px-3 py-2 font-mono text-xs overflow-x-auto whitespace-nowrap bg-muted/20 ${
            mono ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          {value}
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 px-3 border-l border-border label-meta hover:bg-muted/30 transition-colors shrink-0"
        >
          {copied ? (
            <><CheckCircle className="h-3 w-3 text-[#E85A1A]" /> COPIED</>
          ) : (
            <><Copy className="h-3 w-3" /> COPY</>
          )}
        </button>
      </div>
    </div>
  )
}
