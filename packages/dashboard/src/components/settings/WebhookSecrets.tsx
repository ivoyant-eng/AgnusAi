import { useState, useEffect } from 'react'
import { AlertTriangle, Copy, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePermissions } from '@/hooks/usePermissions'

type Platform = 'github' | 'azure'
type WebhookEntry = { platform: string; path: string; secretPreview: string }
type Org = { orgKey: string; orgName: string; platform: Platform }

export function WebhookSecrets() {
  const { isOrgAdmin } = usePermissions()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [selectedOrgKey, setSelectedOrgKey] = useState('')
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([])
  const [platform, setPlatform] = useState<Platform>('github')
  const [newSecret, setNewSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const [rotating, setRotating] = useState(false)

  useEffect(() => {
    fetch('/api/orgs', { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<Org[]> : [])
      .then(list => { setOrgs(list); if (list.length > 0) setSelectedOrgKey(list[0].orgKey) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedOrgKey || !isOrgAdmin) return
    setNewSecret('')
    fetch(`/api/orgs/${encodeURIComponent(selectedOrgKey)}/webhooks`, { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ webhooks: WebhookEntry[] }> : null)
      .then(d => { if (d?.webhooks) setWebhooks(d.webhooks) })
      .catch(() => {})
  }, [selectedOrgKey, isOrgAdmin])

  async function rotate() {
    if (!selectedOrgKey) return
    setRotating(true)
    setNewSecret('')
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(selectedOrgKey)}/webhooks/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ platform }),
      })
      const d = await res.json() as { secret: string }
      setNewSecret(d.secret)
      const listRes = await fetch(`/api/orgs/${encodeURIComponent(selectedOrgKey)}/webhooks`, { credentials: 'include' })
      if (listRes.ok) {
        const list = await listRes.json() as { webhooks: WebhookEntry[] }
        setWebhooks(list.webhooks)
      }
    } finally {
      setRotating(false)
    }
  }

  function copy() {
    navigator.clipboard.writeText(newSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <p className="label-meta mb-3" style={{ color: '#E85A1A' }}>// webhook-secrets</p>
      <h1 className="text-[clamp(1.4rem,2.5vw,2rem)] font-bold leading-none tracking-tight text-foreground mb-2">
        Webhook Secrets.
      </h1>
      <p className="text-sm text-muted-foreground font-mono">
        Set the generated secret as{' '}
        <code className="bg-muted/40 px-1">X-Webhook-Secret</code> (Azure) or the webhook secret field (GitHub) in your repository settings.
      </p>

      {orgs.length > 1 && (
        <div className="max-w-md space-y-2">
          <p className="label-meta">Organization</p>
          <Select value={selectedOrgKey} onValueChange={v => { setSelectedOrgKey(v); setNewSecret('') }}>
            <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
            <SelectContent>
              {orgs.map(o => <SelectItem key={o.orgKey} value={o.orgKey}>{o.platform} / {o.orgName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {webhooks.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Active Secrets</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead>Webhook URL</TableHead>
                  <TableHead className="text-right">Secret Preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map(w => (
                  <TableRow key={w.platform}>
                    <TableCell className="uppercase">{w.platform}</TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-xs">{w.path}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{w.secretPreview}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Generate / Rotate Secret</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Select value={platform} onValueChange={v => { setPlatform(v as Platform); setNewSecret('') }}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="azure">Azure</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={rotate} disabled={rotating || !selectedOrgKey}>
              {rotating ? 'Generating...' : webhooks.some(w => w.platform === platform) ? 'Rotate Secret' : 'Generate Secret'}
            </Button>
          </div>

          {newSecret && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-[#E85A1A]" />
                <span className="label-meta text-[#E85A1A]">Copy this secret now — it won't be shown again.</span>
              </div>
              <div className="flex items-stretch border border-[#E85A1A]">
                <div className="flex-1 px-4 py-3 font-mono text-sm overflow-x-auto whitespace-nowrap bg-muted/20">
                  {newSecret}
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
        </CardContent>
      </Card>
    </div>
  )
}
