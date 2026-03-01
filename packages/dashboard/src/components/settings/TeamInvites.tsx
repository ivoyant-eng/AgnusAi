import { useState } from 'react'
import { Copy, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function TeamInvites() {
  const [inviteUrl, setInviteUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
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
      setLoading(false)
    }
  }

  function copy() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <p className="label-meta mb-3" style={{ color: '#E85A1A' }}>// team</p>
      <h1 className="text-[clamp(1.4rem,2.5vw,2rem)] font-bold leading-none tracking-tight text-foreground mb-8">
        Invite Members.
      </h1>

      <div className="border-t border-border pt-6">
        <p className="text-sm text-muted-foreground mb-6">
          Generate a one-time invite link. The recipient will be able to create an account.
        </p>

        <Button size="lg" variant="outline" onClick={generate} disabled={loading}>
          {loading ? 'Generating...' : 'Generate Invite Link'}
        </Button>

        {inviteUrl && (
          <div className="flex items-stretch border border-border mt-6">
            <div className="flex-1 px-4 py-3 font-mono text-sm text-muted-foreground overflow-x-auto whitespace-nowrap bg-muted/20">
              {inviteUrl}
            </div>
            <button
              onClick={copy}
              className="flex items-center gap-2 px-4 border-l border-border label-meta hover:bg-muted/30 transition-colors"
            >
              {copied
                ? <><CheckCircle className="h-3.5 w-3.5 text-[#E85A1A]" /> COPIED</>
                : <><Copy className="h-3.5 w-3.5" /> COPY</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
