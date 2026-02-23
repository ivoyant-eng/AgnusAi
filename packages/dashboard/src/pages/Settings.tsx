import { useState, useEffect } from 'react'
import { Check, Copy, CheckCircle, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'

type Depth = 'fast' | 'standard' | 'deep'

const DEPTH_OPTIONS: Array<{
  key: Depth
  label: string
  hops: string
  embeddings: string
  desc: string
  recommended?: boolean
}> = [
  {
    key: 'fast',
    label: 'Fast',
    hops: '1-hop traversal',
    embeddings: 'No embeddings',
    desc: 'Direct callers only. Lowest latency, minimal token usage.',
  },
  {
    key: 'standard',
    label: 'Standard',
    hops: '2-hop traversal',
    embeddings: 'No embeddings',
    desc: 'Direct and transitive callers. Best balance of context vs. cost.',
    recommended: true,
  },
  {
    key: 'deep',
    label: 'Deep',
    hops: '2-hop traversal',
    embeddings: 'Semantic search',
    desc: 'Adds vector-similar symbols for cross-cutting concern detection.',
  },
]

export default function Settings() {
  const { user } = useAuth()
  const [depth, setDepth] = useState<Depth>('standard')
  const [saved, setSaved] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)
  // API key state
  const [apiKeyPreview, setApiKeyPreview] = useState<string | null>(null)
  const [newApiKey, setNewApiKey] = useState('')
  const [apiKeyCopied, setApiKeyCopied] = useState(false)
  const [apiKeyLoading, setApiKeyLoading] = useState(false)

  // Load saved depth on mount
  useEffect(() => {
    fetch('/api/settings', { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ reviewDepth: Depth }> : null)
      .then(d => { if (d?.reviewDepth) setDepth(d.reviewDepth) })
      .catch(() => {})
  }, [])

  // Load API key preview (admin only)
  useEffect(() => {
    if (user?.role !== 'admin') return
    fetch('/api/auth/api-key', { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ exists: boolean; preview?: string }> : null)
      .then(d => { if (d?.exists && d.preview) setApiKeyPreview(d.preview) })
      .catch(() => {})
  }, [user])

  async function save() {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reviewDepth: depth }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function generateInvite() {
    setInviteLoading(true)
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      const d = await res.json() as { url: string }
      setInviteUrl(d.url)
    } finally {
      setInviteLoading(false)
    }
  }

  function copyInvite() {
    navigator.clipboard.writeText(inviteUrl)
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

  async function generateApiKey() {
    setApiKeyLoading(true)
    setNewApiKey('')
    try {
      const res = await fetch('/api/auth/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const d = await res.json() as { key: string }
      setNewApiKey(d.key)
      setApiKeyPreview(`${d.key.slice(0, 12)}...${d.key.slice(-4)}`)
    } finally {
      setApiKeyLoading(false)
    }
  }

  function copyApiKey() {
    navigator.clipboard.writeText(newApiKey)
    setApiKeyCopied(true)
    setTimeout(() => setApiKeyCopied(false), 2000)
  }

  return (
    <div className="max-w-2xl">
      <p className="label-meta mb-4">Settings</p>

      <h1 className="text-[clamp(2rem,5vw,4rem)] font-bold leading-none tracking-tight text-foreground mb-12">
        Review Depth.
      </h1>

      {/* Options — TinyFish numbered list style */}
      <div className="border-t border-border mb-10">
        {DEPTH_OPTIONS.map((opt, i) => {
          const isSelected = depth === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => setDepth(opt.key)}
              className={cn(
                'w-full flex items-start gap-8 border-b border-border py-6 text-left transition-colors hover:bg-muted/20',
                isSelected && 'bg-muted/30',
              )}
            >
              {/* Check / index */}
              <span className={cn('num-display w-8 shrink-0 pt-0.5', isSelected && 'text-[#E85A1A]')}>
                {isSelected
                  ? <Check className="h-4 w-4 text-[#E85A1A]" />
                  : String(i + 1).padStart(2, '0')
                }
              </span>

              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-semibold text-base">{opt.label}</span>
                  {opt.recommended && (
                    <Badge variant="default" className="text-[10px] py-0">
                      Recommended
                    </Badge>
                  )}
                </div>
                <p className="label-meta">{opt.hops} · {opt.embeddings}</p>
                <p className="text-sm text-muted-foreground mt-2 font-mono">{opt.desc}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Token impact table */}
      <div className="border border-border mb-10">
        <div className="grid grid-cols-4 border-b border-border">
          {['', 'Fast', 'Standard', 'Deep'].map((h) => (
            <div key={h} className={cn('px-4 py-3 label-meta', !h && 'border-r border-border')}>
              {h}
            </div>
          ))}
        </div>
        {[
          { label: 'Graph hops', fast: '1', standard: '2', deep: '2' },
          { label: 'Embedding search', fast: '—', standard: '—', deep: '✓' },
          { label: 'Extra tokens', fast: '~200', standard: '~600', deep: '~1 200' },
          { label: 'Latency added', fast: '<1ms', standard: '<2ms', deep: '~150ms' },
        ].map(row => (
          <div key={row.label} className="grid grid-cols-4 border-b border-border last:border-0">
            <div className="px-4 py-3 label-meta border-r border-border">{row.label}</div>
            {[row.fast, row.standard, row.deep].map((val, ci) => (
              <div
                key={ci}
                className={cn(
                  'px-4 py-3 font-mono text-sm',
                  (ci === 0 && depth === 'fast') ||
                  (ci === 1 && depth === 'standard') ||
                  (ci === 2 && depth === 'deep')
                    ? 'bg-muted/30 text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {val}
              </div>
            ))}
          </div>
        ))}
      </div>

      <Button size="lg" onClick={save} disabled={saved}>
        {saved ? '✓ Saved' : 'Save Settings'}
      </Button>

      {/* Team section — admin only */}
      {user?.role === 'admin' && (
        <div className="mt-16">
          <p className="label-meta mb-4">Team</p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground mb-8">
            Invite Members.
          </h2>

          <div className="border-t border-border pt-6">
            <p className="text-sm text-muted-foreground mb-6">
              Generate a one-time invite link. The recipient will be able to create an account.
            </p>

            <Button
              size="lg"
              variant="outline"
              onClick={generateInvite}
              disabled={inviteLoading}
            >
              {inviteLoading ? 'Generating...' : 'Generate Invite Link'}
            </Button>

            {inviteUrl && (
              <div className="flex items-stretch border border-border mt-6">
                <div className="flex-1 px-4 py-3 font-mono text-sm text-muted-foreground overflow-x-auto whitespace-nowrap bg-muted/20">
                  {inviteUrl}
                </div>
                <button
                  onClick={copyInvite}
                  className="flex items-center gap-2 px-4 border-l border-border label-meta hover:bg-muted/30 transition-colors"
                >
                  {inviteCopied
                    ? <><CheckCircle className="h-3.5 w-3.5 text-[#E85A1A]" /> COPIED</>
                    : <><Copy className="h-3.5 w-3.5" /> COPY</>
                  }
                </button>
              </div>
            )}
          </div>

          {/* API Key section */}
          <div className="mt-12">
            <p className="label-meta mb-4">CI/CD Access</p>
            <h2 className="text-2xl font-bold tracking-tight text-foreground mb-8">
              API Key.
            </h2>

            <div className="border-t border-border pt-6">
              <p className="text-sm text-muted-foreground mb-2">
                Use this key to trigger reviews from CI/CD pipelines via{' '}
                <code className="font-mono text-xs bg-muted/40 px-1">Authorization: Bearer &lt;key&gt;</code>.
              </p>

              {apiKeyPreview && !newApiKey && (
                <div className="flex items-center gap-3 mb-6 mt-4">
                  <span className="label-meta">Current key:</span>
                  <span className="font-mono text-sm text-muted-foreground">{apiKeyPreview}</span>
                </div>
              )}

              {!apiKeyPreview && !newApiKey && (
                <p className="text-sm text-muted-foreground mb-6 mt-4">No API key generated yet.</p>
              )}

              <Button
                size="lg"
                variant="outline"
                onClick={generateApiKey}
                disabled={apiKeyLoading}
              >
                {apiKeyLoading ? 'Generating...' : apiKeyPreview ? 'Regenerate API Key' : 'Generate API Key'}
              </Button>

              {newApiKey && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#E85A1A]" />
                    <span className="label-meta text-[#E85A1A]">Copy this key now — it won't be shown again.</span>
                  </div>
                  <div className="flex items-stretch border border-[#E85A1A]">
                    <div className="flex-1 px-4 py-3 font-mono text-sm overflow-x-auto whitespace-nowrap bg-muted/20">
                      {newApiKey}
                    </div>
                    <button
                      onClick={copyApiKey}
                      className="flex items-center gap-2 px-4 border-l border-[#E85A1A] label-meta hover:bg-muted/30 transition-colors"
                    >
                      {apiKeyCopied
                        ? <><CheckCircle className="h-3.5 w-3.5 text-[#E85A1A]" /> COPIED</>
                        : <><Copy className="h-3.5 w-3.5" /> COPY</>
                      }
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
