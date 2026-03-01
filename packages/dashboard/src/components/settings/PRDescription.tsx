import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

type UpdateMode = 'created_only' | 'created_and_updated'
type PublishMode = 'replace_pr' | 'comment'
type Platform = 'github' | 'azure'

type PRDescriptionSettings = {
  enabled: boolean
  updateMode: UpdateMode
  publishMode: PublishMode
  preserveOriginal: boolean
  useMarkers: boolean
  publishLabels: boolean
}

type PRDescriptionOverrides = Partial<{
  enabled: boolean | null
  updateMode: UpdateMode | null
  publishMode: PublishMode | null
  preserveOriginal: boolean | null
  useMarkers: boolean | null
  publishLabels: boolean | null
}>

type Repo = { repoId: string; repoUrl: string; platform: Platform }
type Org = { orgKey: string; orgName: string; platform: Platform }

const UPDATE_MODE_OPTIONS = [
  { value: 'created_only' as UpdateMode, label: 'created only' },
  { value: 'created_and_updated' as UpdateMode, label: 'created and updated' },
]

const PUBLISH_MODE_OPTIONS = [
  { value: 'replace_pr' as PublishMode, label: 'replace PR body' },
  { value: 'comment' as PublishMode, label: 'publish as comment' },
]

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="label-meta flex items-center justify-between gap-3">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function EnumSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="space-y-2">
      <label className="label-meta">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function OverrideSelect({ label, value, options, onChange }: {
  label: string
  value: string | boolean | null | undefined
  options?: Array<{ value: string; label: string }>
  onChange: (v: string | boolean | null) => void
}) {
  const strVal = value == null ? 'inherit' : String(value)

  function handleChange(v: string) {
    if (v === 'inherit') return onChange(null)
    if (!options) return onChange(v === 'true')
    return onChange(v)
  }

  return (
    <div className="space-y-2">
      <label className="label-meta">{label}</label>
      <Select value={strVal} onValueChange={handleChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">inherit</SelectItem>
          {options
            ? options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)
            : <><SelectItem value="true">true</SelectItem><SelectItem value="false">false</SelectItem></>
          }
        </SelectContent>
      </Select>
    </div>
  )
}

export function PRDescription() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [orgs, setOrgs] = useState<Org[]>([])
  const [selectedOrgKey, setSelectedOrgKey] = useState('')
  const [selectedRepoId, setSelectedRepoId] = useState('')
  const [orgSettings, setOrgSettings] = useState<PRDescriptionSettings | null>(null)
  const [repoEffective, setRepoEffective] = useState<PRDescriptionSettings | null>(null)
  const [repoOverrides, setRepoOverrides] = useState<PRDescriptionOverrides>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/repos', { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<Repo[]> : [])
      .then(r => { setRepos(r); if (r.length > 0) setSelectedRepoId(r[0].repoId) })
      .catch(() => {})
    fetch('/api/orgs', { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<Org[]> : [])
      .then(o => { setOrgs(o); if (o.length > 0) setSelectedOrgKey(o[0].orgKey) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedOrgKey) return
    fetch(`/api/orgs/${encodeURIComponent(selectedOrgKey)}/settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ prDescription: PRDescriptionSettings }> : null)
      .then(d => { if (d?.prDescription) setOrgSettings(d.prDescription) })
      .catch(() => {})
  }, [selectedOrgKey])

  useEffect(() => {
    if (!selectedRepoId) return
    fetch(`/api/repos/${encodeURIComponent(selectedRepoId)}/settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ prDescription: { effective: PRDescriptionSettings; overrides: PRDescriptionOverrides } }> : null)
      .then(d => {
        if (d?.prDescription?.effective) setRepoEffective(d.prDescription.effective)
        if (d?.prDescription?.overrides) setRepoOverrides(d.prDescription.overrides)
      })
      .catch(() => {})
  }, [selectedRepoId])

  function flash() { setSaved(true); setTimeout(() => setSaved(false), 1500) }

  async function saveOrg() {
    const org = orgs.find(o => o.orgKey === selectedOrgKey)
    if (!org || !orgSettings) return
    await fetch(`/api/orgs/${encodeURIComponent(org.orgKey)}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ platform: org.platform, orgName: org.orgName, prDescription: orgSettings }),
    })
    flash()
  }

  async function saveRepo() {
    if (!selectedRepoId) return
    await fetch(`/api/repos/${encodeURIComponent(selectedRepoId)}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prDescription: repoOverrides }),
    })
    const res = await fetch(`/api/repos/${encodeURIComponent(selectedRepoId)}/settings`, { credentials: 'include' })
    if (res.ok) {
      const d = await res.json() as { prDescription: { effective: PRDescriptionSettings; overrides: PRDescriptionOverrides } }
      setRepoEffective(d.prDescription.effective)
      setRepoOverrides(d.prDescription.overrides)
    }
    flash()
  }

  return (
    <div className="space-y-8">
      <p className="label-meta mb-3" style={{ color: '#E85A1A' }}>// pr-description</p>
      <h1 className="text-[clamp(1.4rem,2.5vw,2rem)] font-bold leading-none tracking-tight text-foreground">
        PR Description Rules.
      </h1>

      <Card>
        <CardHeader><CardTitle>Organization Defaults</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <Select value={selectedOrgKey} onValueChange={setSelectedOrgKey}>
              <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
              <SelectContent>
                {orgs.map(o => <SelectItem key={o.orgKey} value={o.orgKey}>{o.platform} / {o.orgName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {orgSettings && (
            <div className="grid gap-3 max-w-xl">
              <SwitchRow label="Enable PR description generation" checked={orgSettings.enabled} onChange={v => setOrgSettings({ ...orgSettings, enabled: v })} />
              <EnumSelect label="Update mode" value={orgSettings.updateMode} options={UPDATE_MODE_OPTIONS} onChange={v => setOrgSettings({ ...orgSettings, updateMode: v })} />
              <EnumSelect label="Publish mode" value={orgSettings.publishMode} options={PUBLISH_MODE_OPTIONS} onChange={v => setOrgSettings({ ...orgSettings, publishMode: v })} />
              <SwitchRow label="Preserve original description" checked={orgSettings.preserveOriginal} onChange={v => setOrgSettings({ ...orgSettings, preserveOriginal: v })} />
              <SwitchRow label="Update only when markers present" checked={orgSettings.useMarkers} onChange={v => setOrgSettings({ ...orgSettings, useMarkers: v })} />
              <SwitchRow label="Publish labels" checked={orgSettings.publishLabels} onChange={v => setOrgSettings({ ...orgSettings, publishLabels: v })} />
            </div>
          )}
          <Button onClick={saveOrg} disabled={!selectedOrgKey}>{saved ? '✓ Saved' : 'Save Org Defaults'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Repository Overrides</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
              <SelectTrigger><SelectValue placeholder="Select repository" /></SelectTrigger>
              <SelectContent>
                {repos.map(r => <SelectItem key={r.repoId} value={r.repoId}>{r.platform} / {r.repoUrl.split('/').slice(-2).join('/')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {repoEffective && (
            <p className="label-meta text-muted-foreground">
              Effective: {repoEffective.updateMode}, {repoEffective.publishMode}, labels={String(repoEffective.publishLabels)}
            </p>
          )}
          <div className="grid gap-3 max-w-xl">
            <OverrideSelect label="Enabled" value={repoOverrides.enabled} onChange={v => setRepoOverrides({ ...repoOverrides, enabled: v as boolean | null })} />
            <OverrideSelect label="Update mode" value={repoOverrides.updateMode} options={UPDATE_MODE_OPTIONS} onChange={v => setRepoOverrides({ ...repoOverrides, updateMode: v as UpdateMode | null })} />
            <OverrideSelect label="Publish mode" value={repoOverrides.publishMode} options={PUBLISH_MODE_OPTIONS} onChange={v => setRepoOverrides({ ...repoOverrides, publishMode: v as PublishMode | null })} />
            <OverrideSelect label="Preserve original" value={repoOverrides.preserveOriginal} onChange={v => setRepoOverrides({ ...repoOverrides, preserveOriginal: v as boolean | null })} />
            <OverrideSelect label="Use markers" value={repoOverrides.useMarkers} onChange={v => setRepoOverrides({ ...repoOverrides, useMarkers: v as boolean | null })} />
            <OverrideSelect label="Publish labels" value={repoOverrides.publishLabels} onChange={v => setRepoOverrides({ ...repoOverrides, publishLabels: v as boolean | null })} />
          </div>
          <Button onClick={saveRepo} disabled={!selectedRepoId}>{saved ? '✓ Saved' : 'Save Repo Overrides'}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
