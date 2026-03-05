import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Save, Trash2, Copy, CheckCircle, RefreshCw, Plus, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import { PemUpload } from '@/components/PemUpload'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

interface SavedCredential {
  id: string
  label: string
  token: string
  platform: 'github' | 'azure'
}

interface VcsInstallation {
  id: string
  platform: string
  display_name: string | null
  account_login: string | null
  account_type: string | null
  github_app_id: string | null
  github_app_installation_id: string | null
  created_at: string
}

type AppRepo = { id: number; name: string; fullName: string; url: string; private: boolean }
type AppInstallationMeta = { accountLogin: string | null; accountType: string | null; repositorySelection: string }

const CREDS_KEY = 'ryv:saved_credentials'

function loadCredentials(): SavedCredential[] {
  try { return JSON.parse(localStorage.getItem(CREDS_KEY) ?? '[]') } catch { return [] }
}
function saveCredential(cred: SavedCredential) {
  const existing = loadCredentials().filter(c => c.id !== cred.id)
  localStorage.setItem(CREDS_KEY, JSON.stringify([...existing, cred]))
}
function deleteCredential(id: string) {
  localStorage.setItem(CREDS_KEY, JSON.stringify(loadCredentials().filter(c => c.id !== id)))
}

export default function Connect() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [platform, setPlatform] = useState<'github' | 'azure'>('github')

  // ── Webhook config panel ──────────────────────────────────────────────────
  const activeOrgSlug = user?.orgs?.find((o: { orgId: string; slug: string }) => o.orgId === user.activeOrgId)?.slug
  const webhookPath = platform === 'azure'
    ? (activeOrgSlug ? `/api/webhooks/azure/${activeOrgSlug}` : '/api/webhooks/azure')
    : (activeOrgSlug ? `/api/webhooks/github/${activeOrgSlug}` : '/api/webhooks/github')
  const webhookUrl = `${window.location.origin}${webhookPath}`
  const [webhookCopied, setWebhookCopied] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)
  const [rotating, setRotating] = useState(false)

  const { data: webhookData, mutate: mutateWebhooks } = useSWR<{ webhooks: Array<{ platform: string; secretPreview: string }> }>(
    activeOrgSlug ? `/api/orgs/${activeOrgSlug}/webhooks` : null,
    fetcher,
  )
  const secretPreview = webhookData?.webhooks?.find(w => w.platform === platform)?.secretPreview

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
  async function handleRotateSecret() {
    if (!activeOrgSlug) return
    setRotating(true)
    try {
      const res = await fetch(`/api/orgs/${activeOrgSlug}/webhooks/rotate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ platform }),
      })
      const data = await res.json() as { secret?: string }
      if (data.secret) { setRevealedSecret(data.secret); mutateWebhooks() }
    } finally { setRotating(false) }
  }

  // ── VCS Installations (GitHub App profiles) ──────────────────────────────
  const { data: installationsData, mutate: mutateInstallations } = useSWR<{ installations: VcsInstallation[] }>(
    '/api/vcs-installations', fetcher,
  )
  const installations = (installationsData?.installations ?? []).filter(i => i.platform === platform)

  const [showAddInstallation, setShowAddInstallation] = useState(false)
  const [addForm, setAddForm] = useState({ appId: '', privateKey: '', installationId: '', displayName: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  async function handleSaveInstallation(e: React.FormEvent) {
    e.preventDefault()
    setAddSaving(true)
    setAddError('')
    try {
      const res = await fetch('/api/vcs-installations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          platform,
          displayName: addForm.displayName || undefined,
          appId: addForm.appId,
          privateKey: addForm.privateKey,
          installationId: addForm.installationId,
        }),
      })
      const data = await res.json() as { installation?: VcsInstallation; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to save')
      await mutateInstallations()
      setShowAddInstallation(false)
      setAddForm({ appId: '', privateKey: '', installationId: '', displayName: '' })
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAddSaving(false)
    }
  }

  async function handleRemoveInstallation(id: string) {
    await fetch(`/api/vcs-installations/${id}`, { method: 'DELETE', credentials: 'include' })
    mutateInstallations()
  }

  // ── Per-installation repo picker state ───────────────────────────────────
  const DEFAULT_PICKER_STATE = { repos: [] as AppRepo[], meta: null as AppInstallationMeta | null, loading: false, error: '', open: false, search: '', selected: null as AppRepo | null, connectError: '' }
  type PickerState = typeof DEFAULT_PICKER_STATE

  const [pickerState, setPickerState] = useState<Record<string, PickerState>>({})
  const pickerRefs = useRef<Record<string, HTMLDivElement | null>>({})

  function getPickerState(id: string): PickerState {
    return pickerState[id] ?? { ...DEFAULT_PICKER_STATE }
  }
  // Always use prev[id] as base inside the functional updater to avoid stale closures
  function setInstPickerState(id: string, patch: Partial<PickerState>) {
    setPickerState(prev => {
      const base = prev[id] ?? { ...DEFAULT_PICKER_STATE }
      return { ...prev, [id]: { ...base, ...patch } }
    })
  }

  async function fetchInstRepos(inst: VcsInstallation) {
    setInstPickerState(inst.id, { loading: true, error: '', repos: [], meta: null, selected: null })
    try {
      const res = await fetch(`/api/vcs-installations/${inst.id}/repos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: '{}',
      })
      const data = await res.json() as { repos?: AppRepo[]; installation?: AppInstallationMeta; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to fetch repositories')
      setInstPickerState(inst.id, { repos: data.repos ?? [], meta: data.installation ?? null, loading: false, open: true })
    } catch (err) {
      setInstPickerState(inst.id, { loading: false, error: (err as Error).message })
    }
  }

  // Close pickers on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      Object.entries(pickerRefs.current).forEach(([id, ref]) => {
        if (ref && !ref.contains(e.target as Node)) {
          setInstPickerState(id, { open: false })
        }
      })
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── PAT / Azure form ──────────────────────────────────────────────────────
  const [patForm, setPatForm] = useState({ repoUrl: '', token: '', repoPath: '', branchesInput: '' })
  const [savedCreds, setSavedCreds] = useState<SavedCredential[]>([])
  const [saveLabel, setSaveLabel] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  useEffect(() => {
    setSavedCreds(loadCredentials().filter(c => c.platform === platform))
  }, [platform])

  function handleSelectCredential(id: string) {
    const cred = savedCreds.find(c => c.id === id)
    if (cred) setPatForm(f => ({ ...f, token: cred.token }))
  }
  function handleSaveCredential() {
    if (!saveLabel.trim() || !patForm.token) return
    const cred: SavedCredential = { id: Date.now().toString(), label: saveLabel.trim(), token: patForm.token, platform }
    saveCredential(cred)
    setSavedCreds(loadCredentials().filter(c => c.platform === platform))
    setSaveLabel(''); setShowSaveInput(false)
  }
  function handleDeleteCredential(id: string) {
    deleteCredential(id)
    setSavedCreds(loadCredentials().filter(c => c.platform === platform))
  }

  // ── Submit handlers ───────────────────────────────────────────────────────
  async function connectViaInstallation(inst: VcsInstallation, repo: AppRepo, branches: string[]) {
    setInstPickerState(inst.id, { connectError: '' })
    setInstPickerState(inst.id, { loading: true })
    try {
      const res = await fetch('/api/repos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ repoUrl: repo.url, platform, branches, vcsInstallationId: inst.id }),
      })
      const data = await res.json() as { repoId?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      navigate(`/app/indexing/${data.repoId}?branch=${encodeURIComponent(branches[0])}`)
    } catch (err) {
      setInstPickerState(inst.id, { connectError: (err as Error).message })
    } finally {
      setInstPickerState(inst.id, { loading: false })
    }
  }

  async function handlePatSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const branches = patForm.branchesInput
        ? patForm.branchesInput.split(',').map(s => s.trim()).filter(Boolean)
        : ['main']
      const res = await fetch('/api/repos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ repoUrl: patForm.repoUrl, platform, token: patForm.token, repoPath: patForm.repoPath || undefined, branches }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error ?? 'Request failed')
      }
      const { repoId } = await res.json() as { repoId: string }
      navigate(`/app/indexing/${repoId}?branch=${encodeURIComponent(branches[0])}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

      {/* ── Left col ── */}
      <div>
        <p className="label-meta mb-4">Connect a Repository</p>
        <h1 className="text-[clamp(1.8rem,3.5vw,3rem)] font-bold leading-none tracking-tight text-foreground mb-10">
          Index.<br />Review.<br />Ship.
        </h1>

        <div className="border-t border-border">
          {[
            { n: '01', title: 'Connect', desc: 'Pick a repo from your saved GitHub App installation. Ryv uses it to clone and post review comments.' },
            { n: '02', title: 'Index', desc: 'Tree-sitter WASM parses every file. Symbols and call edges go into Postgres + pgvector.' },
            { n: '03', title: 'Review', desc: 'Every PR webhook triggers a 2-hop BFS. Blast radius is surfaced to the LLM before it writes a single comment.' },
          ].map((s, i) => (
            <div key={s.n} className="flex items-start gap-8 border-b border-border py-5">
              <span className={`num-display w-8 shrink-0 ${i === 0 ? 'text-foreground' : ''}`}>{s.n}</span>
              <div>
                <p className={`text-sm font-semibold mb-1 ${i === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{s.title}</p>
                <p className="label-meta leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Webhook config */}
        <div className="mt-6 border border-border">
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
            <div className="space-y-1.5">
              <p className="label-meta">{platform === 'github' ? 'Payload URL' : 'URL'}</p>
              <div className="flex items-stretch border border-border">
                <div className="flex-1 px-3 py-2 font-mono text-xs text-muted-foreground overflow-x-auto whitespace-nowrap bg-muted/20">{webhookUrl}</div>
                <button type="button" onClick={copyWebhook} className="flex items-center gap-1.5 px-3 border-l border-border label-meta hover:bg-muted/30 transition-colors shrink-0">
                  {webhookCopied ? <><CheckCircle className="h-3 w-3 text-[#E85A1A]" /> COPIED</> : <><Copy className="h-3 w-3" /> COPY</>}
                </button>
              </div>
            </div>
            {platform === 'github' && (
              <div className="space-y-1.5">
                <p className="label-meta">Content type</p>
                <p className="font-mono text-xs text-foreground">application/json</p>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="label-meta">{platform === 'github' ? 'Secret' : 'X-Webhook-Secret header value'}</p>
              {revealedSecret ? (
                <div className="flex items-stretch border border-border">
                  <div className="flex-1 px-3 py-2 font-mono text-xs text-foreground overflow-x-auto whitespace-nowrap bg-muted/20">{revealedSecret}</div>
                  <button type="button" onClick={() => copySecret(revealedSecret)} className="flex items-center gap-1.5 px-3 border-l border-border label-meta hover:bg-muted/30 transition-colors shrink-0">
                    {secretCopied ? <><CheckCircle className="h-3 w-3 text-[#E85A1A]" /> COPIED</> : <><Copy className="h-3 w-3" /> COPY</>}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {secretPreview && <span className="font-mono text-xs text-muted-foreground">{secretPreview}</span>}
                  <button type="button" onClick={handleRotateSecret} disabled={rotating || !activeOrgSlug}
                    className="flex items-center gap-1.5 label-meta hover:text-foreground transition-colors disabled:opacity-40">
                    <RefreshCw className={`h-3 w-3 ${rotating ? 'animate-spin' : ''}`} />
                    {secretPreview ? 'Rotate & reveal' : 'Generate secret'}
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-1.5 pt-1 border-t border-border">
              <p className="label-meta">{platform === 'github' ? 'Events to subscribe' : 'Event types'}</p>
              <p className="font-mono text-xs text-foreground">
                {platform === 'github' ? 'Push  ·  Pull requests' : 'git.push  ·  git.pullrequest.created  ·  git.pullrequest.updated'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right col: form ── */}
      <div className="border border-border">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-card">
          <div style={{ display: 'flex', gap: '5px' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#FF5F57', display: 'block' }} />
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#FEBC2E', display: 'block' }} />
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#28C840', display: 'block' }} />
          </div>
          <span className="font-mono text-xs text-muted-foreground ml-2">connect-repo.ts</span>
        </div>

        <div className="p-6 space-y-6">
          {/* Platform selector */}
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <div className="flex border border-border">
              {(['github', 'azure'] as const).map(p => (
                <button key={p} type="button"
                  className={`flex-1 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors ${platform === p ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setPlatform(p)}>
                  {p === 'github' ? 'GitHub' : 'Azure DevOps'}
                </button>
              ))}
              {/* Future platforms — grayed out */}
              {(['GitLab', 'Bitbucket'] as const).map(p => (
                <button key={p} type="button" disabled
                  className="flex-1 py-1.5 text-xs font-mono uppercase tracking-widest text-muted-foreground/30 cursor-not-allowed"
                  title="Coming soon">
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* ── GitHub App installations ── */}
          {platform === 'github' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>GitHub App Installations</Label>
                <button type="button" onClick={() => setShowAddInstallation(v => !v)}
                  className="flex items-center gap-1 label-meta hover:text-foreground transition-colors">
                  <Plus className="h-3 w-3" />
                  {showAddInstallation ? 'Cancel' : 'Add installation'}
                </button>
              </div>

              {/* Add installation form */}
              {showAddInstallation && (
                <form onSubmit={handleSaveInstallation} className="border border-border p-4 space-y-3 bg-muted/5">
                  <p className="label-meta" style={{ color: 'var(--lp-accent)' }}>// new GitHub App installation</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="add-appId">App ID</Label>
                    <Input id="add-appId" type="number" placeholder="123456"
                      value={addForm.appId} onChange={e => setAddForm(f => ({ ...f, appId: e.target.value }))} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Private Key (.pem)</Label>
                    <PemUpload value={addForm.privateKey} onChange={pem => setAddForm(f => ({ ...f, privateKey: pem }))} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="add-installId">Installation ID</Label>
                    <Input id="add-installId" type="number" placeholder="78901234"
                      value={addForm.installationId} onChange={e => setAddForm(f => ({ ...f, installationId: e.target.value }))} required />
                    <p className="label-meta">
                      Find it at <span className="font-mono text-foreground">github.com/settings/installations</span> — click your App, the URL ends with the ID.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="add-name">Label <span className="label-meta">(optional)</span></Label>
                    <Input id="add-name" placeholder="e.g. theashishmaurya personal"
                      value={addForm.displayName} onChange={e => setAddForm(f => ({ ...f, displayName: e.target.value }))} />
                  </div>
                  {addError && <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">{addError}</p>}
                  <Button type="submit" size="sm" disabled={addSaving}>
                    {addSaving ? 'Validating…' : 'Save Installation'}
                  </Button>
                </form>
              )}

              {/* Saved installation cards */}
              {installations.length === 0 && !showAddInstallation && (
                <div className="border border-dashed border-border px-4 py-5 text-center">
                  <p className="label-meta mb-2">No GitHub App installations configured.</p>
                  <button type="button" onClick={() => setShowAddInstallation(true)}
                    className="font-mono text-xs text-foreground hover:text-[#E85A1A] transition-colors">
                    + Set up a GitHub App →
                  </button>
                </div>
              )}

              {installations.map(inst => {
                const ps = getPickerState(inst.id)
                return (
                  <InstallationCard
                    key={inst.id}
                    inst={inst}
                    ps={ps}
                    pickerRef={(el) => { pickerRefs.current[inst.id] = el }}
                    onFetch={() => fetchInstRepos(inst)}
                    onPickerToggle={() => setInstPickerState(inst.id, { open: !ps.open, search: '' })}
                    onSearch={(s) => setInstPickerState(inst.id, { search: s })}
                    onSelect={(repo) => setInstPickerState(inst.id, { selected: repo, open: false, search: '' })}
                    onRemove={() => handleRemoveInstallation(inst.id)}
                    onConnect={(repo, branches) => connectViaInstallation(inst, repo, branches)}
                  />
                )
              })}

              {/* Divider to PAT fallback */}
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 border-t border-border" />
                <span className="label-meta">or use PAT instead</span>
                <div className="flex-1 border-t border-border" />
              </div>
            </div>
          )}

          {/* ── PAT / Azure form ── */}
          <form onSubmit={handlePatSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repoUrl">Repository URL</Label>
              <Input id="repoUrl"
                placeholder={platform === 'azure' ? 'https://dev.azure.com/org/project/_git/repo' : 'https://github.com/owner/repo'}
                value={patForm.repoUrl} onChange={e => setPatForm(f => ({ ...f, repoUrl: e.target.value }))} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="token">Access Token</Label>
              {savedCreds.length > 0 && (
                <div className="flex gap-2 items-center">
                  <Select onValueChange={handleSelectCredential}>
                    <SelectTrigger className="text-xs h-8"><SelectValue placeholder="Use saved credential…" /></SelectTrigger>
                    <SelectContent>
                      {savedCreds.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center justify-between gap-6 w-full">
                            <span>{c.label}</span>
                            <span className="font-mono text-muted-foreground">{c.token.slice(0, 8)}…</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => { const id = savedCreds.find(c => c.token === patForm.token)?.id; if (id) handleDeleteCredential(id) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              <Input id="token" type="password"
                placeholder={platform === 'azure' ? 'PAT from dev.azure.com…' : 'ghp_…'}
                value={patForm.token} onChange={e => setPatForm(f => ({ ...f, token: e.target.value }))} />
              {patForm.token && !showSaveInput && (
                <button type="button" className="label-meta flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => setShowSaveInput(true)}>
                  <Save className="h-3 w-3" /> Save this token
                </button>
              )}
              {showSaveInput && (
                <div className="flex gap-2">
                  <Input placeholder="Label, e.g. Ashish Azure PAT" value={saveLabel}
                    onChange={e => setSaveLabel(e.target.value)} className="h-8 text-xs"
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSaveCredential())} autoFocus />
                  <Button type="button" size="sm" className="h-8 text-xs shrink-0" onClick={handleSaveCredential}>Save</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs shrink-0" onClick={() => setShowSaveInput(false)}>Cancel</Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="branches">Branches</Label>
              <Input id="branches" placeholder="main, develop"
                value={patForm.branchesInput} onChange={e => setPatForm(f => ({ ...f, branchesInput: e.target.value }))} />
              <p className="label-meta">Comma-separated. Defaults to <code className="font-mono">main</code>.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="repoPath">Local Path <span className="label-meta">(optional)</span></Label>
              <Input id="repoPath" placeholder="/repos/my-repo  or leave blank to auto-clone"
                value={patForm.repoPath} onChange={e => setPatForm(f => ({ ...f, repoPath: e.target.value }))} />
            </div>

            {error && <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">{error}</p>}

            <Button type="submit" size="lg" disabled={loading} className="w-full gap-3 mt-2">
              {loading ? 'Connecting...' : 'Connect Repository'}
              {!loading && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── Installation card component ───────────────────────────────────────────

interface InstallationCardProps {
  inst: VcsInstallation
  ps: {
    repos: AppRepo[]
    meta: AppInstallationMeta | null
    loading: boolean
    error: string
    open: boolean
    search: string
    selected: AppRepo | null
    connectError: string
  }
  pickerRef: (el: HTMLDivElement | null) => void
  onFetch: () => void
  onPickerToggle: () => void
  onSearch: (s: string) => void
  onSelect: (repo: AppRepo) => void
  onRemove: () => void
  onConnect: (repo: AppRepo, branches: string[]) => void
}

function InstallationCard({ inst, ps, pickerRef, onFetch, onPickerToggle, onSearch, onSelect, onRemove, onConnect }: InstallationCardProps) {
  const [branchInput, setBranchInput] = useState('master')

  const displayName = inst.display_name ?? inst.account_login ?? `App #${inst.github_app_id}`
  const accountLabel = inst.account_type ? `${inst.account_type}` : null

  // Auto-fetch repos on first render if none loaded yet
  useEffect(() => {
    if (ps.repos.length === 0 && !ps.loading && !ps.error) {
      onFetch()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst.id])

  return (
    <div className="border border-border p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 text-[#E85A1A] shrink-0" />
            <span className="font-mono text-sm font-semibold text-foreground">{displayName}</span>
            {accountLabel && <span className="label-meta">{accountLabel}</span>}
          </div>
          <p className="label-meta mt-0.5 ml-5">App #{inst.github_app_id} · Installation {inst.github_app_installation_id}</p>
        </div>
        <button type="button" onClick={onRemove} className="label-meta hover:text-destructive transition-colors shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Repo picker */}
      <div ref={pickerRef} className="relative">
        <div className="flex items-center border border-border cursor-pointer hover:bg-muted/10 transition-colors"
          onClick={onPickerToggle}>
          <div className="flex-1 px-3 py-2.5 font-mono text-sm truncate">
            {ps.loading
              ? <span className="text-muted-foreground">Loading repositories…</span>
              : ps.selected
                ? <span className="text-foreground">{ps.selected.fullName}</span>
                : <span className="text-muted-foreground">Select a repository…</span>
            }
          </div>
          <span className="px-3 label-meta">
            {ps.loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        </div>

        {ps.open && (
          <div className="absolute z-50 w-full border border-border bg-card shadow-md mt-px max-h-64 flex flex-col">
            <div className="border-b border-border px-3 py-2">
              <input autoFocus
                className="w-full bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                placeholder="Search repositories…" value={ps.search} onChange={e => onSearch(e.target.value)} />
            </div>
            <div className="overflow-y-auto flex-1">
              {ps.repos.length === 0 && !ps.loading && (
                <div className="px-3 py-3 space-y-1">
                  <p className="label-meta">No repositories found.</p>
                  {ps.meta?.repositorySelection === 'selected' && (
                    <p className="font-mono text-xs text-muted-foreground">
                      Installation is set to <span className="text-foreground">selected repos only</span>.
                      Add repos at github.com/settings/installations.
                    </p>
                  )}
                </div>
              )}
              {ps.repos
                .filter(r => r.fullName.toLowerCase().includes(ps.search.toLowerCase()))
                .map(repo => (
                  <div key={repo.id} onClick={() => onSelect(repo)}
                    className={`flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors ${ps.selected?.id === repo.id ? 'bg-muted/20' : ''}`}>
                    <span className="font-mono text-xs text-foreground truncate">{repo.fullName}</span>
                    {repo.private && <span className="label-meta ml-2 shrink-0">private</span>}
                  </div>
                ))
              }
            </div>
            <div className="border-t border-border px-3 py-2 flex items-center justify-between">
              <span className="label-meta">{ps.repos.length} repos</span>
              {ps.meta?.accountLogin && (
                <span className="font-mono text-xs text-muted-foreground">
                  {ps.meta.accountLogin} · {ps.meta.repositorySelection === 'all' ? 'all repos' : 'selected repos'}
                </span>
              )}
            </div>
          </div>
        )}

        {ps.error && <p className="mt-1 font-mono text-xs text-destructive">{ps.error}</p>}

        <button type="button" onClick={onFetch} disabled={ps.loading}
          className="mt-1.5 flex items-center gap-1.5 label-meta hover:text-foreground transition-colors disabled:opacity-40">
          <RefreshCw className={`h-3 w-3 ${ps.loading ? 'animate-spin' : ''}`} />
          {ps.repos.length > 0 ? 'Refresh list' : 'Fetch repositories'}
        </button>
      </div>

      {/* Branch + connect */}
      {ps.selected && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`branch-${inst.id}`} className="text-xs">Branch</Label>
              <Input id={`branch-${inst.id}`} placeholder="master" value={branchInput}
                onChange={e => setBranchInput(e.target.value)} className="h-8 font-mono text-xs" />
            </div>
            <div className="pt-5">
              <Button size="sm" disabled={ps.loading || !branchInput}
                onClick={() => onConnect(ps.selected!, branchInput.split(',').map(s => s.trim()).filter(Boolean))}>
                {ps.loading ? 'Connecting…' : 'Connect'}
                {!ps.loading && <ArrowRight className="h-3 w-3 ml-1.5" />}
              </Button>
            </div>
          </div>
          {ps.connectError && (
            <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">{ps.connectError}</p>
          )}
        </div>
      )}
    </div>
  )
}
