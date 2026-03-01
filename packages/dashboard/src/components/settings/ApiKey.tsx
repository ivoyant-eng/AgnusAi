import { useState, useEffect } from 'react'
import { AlertTriangle, Copy, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ApiKey() {
  const [preview, setPreview] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/api-key', { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ exists: boolean; preview?: string }> : null)
      .then(d => { if (d?.exists && d.preview) setPreview(d.preview) })
      .catch(() => {})
  }, [])

  async function generate() {
    setLoading(true)
    setNewKey('')
    try {
      const res = await fetch('/api/auth/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const d = await res.json() as { key: string }
      setNewKey(d.key)
      setPreview(`${d.key.slice(0, 12)}...${d.key.slice(-4)}`)
    } finally {
      setLoading(false)
    }
  }

  function copy() {
    navigator.clipboard.writeText(newKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <p className="label-meta mb-3" style={{ color: '#E85A1A' }}>// ci-cd</p>
      <h1 className="text-[clamp(1.4rem,2.5vw,2rem)] font-bold leading-none tracking-tight text-foreground mb-8">
        API Key.
      </h1>

      <div className="border-t border-border pt-6">
        <p className="text-sm text-muted-foreground mb-2">
          Use this key to trigger reviews from CI/CD pipelines via{' '}
          <code className="font-mono text-xs bg-muted/40 px-1">Authorization: Bearer &lt;key&gt;</code>.
        </p>

        {preview && !newKey && (
          <div className="flex items-center gap-3 mb-6 mt-4">
            <span className="label-meta">Current key:</span>
            <span className="font-mono text-sm text-muted-foreground">{preview}</span>
          </div>
        )}
        {!preview && !newKey && (
          <p className="text-sm text-muted-foreground mb-6 mt-4">No API key generated yet.</p>
        )}

        <Button size="lg" variant="outline" onClick={generate} disabled={loading}>
          {loading ? 'Generating...' : preview ? 'Regenerate API Key' : 'Generate API Key'}
        </Button>

        {newKey && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-3.5 w-3.5 text-[#E85A1A]" />
              <span className="label-meta text-[#E85A1A]">Copy this key now — it won't be shown again.</span>
            </div>
            <div className="flex items-stretch border border-[#E85A1A]">
              <div className="flex-1 px-4 py-3 font-mono text-sm overflow-x-auto whitespace-nowrap bg-muted/20">
                {newKey}
              </div>
              <button
                onClick={copy}
                className="flex items-center gap-2 px-4 border-l border-[#E85A1A] label-meta hover:bg-muted/30 transition-colors"
              >
                {copied
                  ? <><CheckCircle className="h-3.5 w-3.5 text-[#E85A1A]" /> COPIED</>
                  : <><Copy className="h-3.5 w-3.5" /> COPY</>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
