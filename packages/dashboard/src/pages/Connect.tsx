import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface SavedCredential {
  id: string
  label: string
  token: string
  platform: 'github' | 'azure'
}

const CREDS_KEY = 'agnus:saved_credentials'

function loadCredentials(): SavedCredential[] {
  try { return JSON.parse(localStorage.getItem(CREDS_KEY) ?? '[]') } catch { return [] }
}

function saveCredential(cred: SavedCredential) {
  const existing = loadCredentials().filter(c => c.id !== cred.id)
  localStorage.setItem(CREDS_KEY, JSON.stringify([...existing, cred]))
}

function deleteCredential(id: string) {
  const updated = loadCredentials().filter(c => c.id !== id)
  localStorage.setItem(CREDS_KEY, JSON.stringify(updated))
}

export default function Connect() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedCreds, setSavedCreds] = useState<SavedCredential[]>([])
  const [saveLabel, setSaveLabel] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [form, setForm] = useState({
    repoUrl: '',
    token: '',
    platform: 'github' as 'github' | 'azure',
    repoPath: '',
    branchesInput: '',
  })

  // Reload saved creds when platform changes
  useEffect(() => {
    setSavedCreds(loadCredentials().filter(c => c.platform === form.platform))
  }, [form.platform])

  function handleSelectCredential(id: string) {
    const cred = savedCreds.find(c => c.id === id)
    if (cred) setForm(f => ({ ...f, token: cred.token }))
  }

  function handleSaveCredential() {
    if (!saveLabel.trim() || !form.token) return
    const cred: SavedCredential = {
      id: Date.now().toString(),
      label: saveLabel.trim(),
      token: form.token,
      platform: form.platform,
    }
    saveCredential(cred)
    setSavedCreds(loadCredentials().filter(c => c.platform === form.platform))
    setSaveLabel('')
    setShowSaveInput(false)
  }

  function handleDeleteCredential(id: string) {
    deleteCredential(id)
    setSavedCreds(loadCredentials().filter(c => c.platform === form.platform))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const branches = form.branchesInput
        ? form.branchesInput.split(',').map(s => s.trim()).filter(Boolean)
        : ['main']
      const { branchesInput: _, ...rest } = form
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...rest, branches }),
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

      {/* ── Left col: context ── */}
      <div>
        <p className="label-meta mb-4">Connect a Repository</p>
        <h1 className="text-[clamp(1.8rem,3.5vw,3rem)] font-bold leading-none tracking-tight text-foreground mb-10">
          Index.<br />Review.<br />Ship.
        </h1>

        {/* Steps */}
        <div className="border-t border-border">
          {[
            { n: '01', title: 'Connect', desc: 'Enter your repo URL and a personal access token. AgnusAI uses it to clone and post review comments.' },
            { n: '02', title: 'Index', desc: 'Tree-sitter WASM parses every file. Symbols and call edges go into Postgres + pgvector.' },
            { n: '03', title: 'Review', desc: 'Every PR webhook triggers a 2-hop BFS. Blast radius is surfaced to the LLM before it writes a single comment.' },
          ].map((s, i) => (
            <div key={s.n} className="flex items-start gap-8 border-b border-border py-5">
              <span className={`num-display w-8 shrink-0 ${i === 0 ? 'text-foreground' : ''}`}>{s.n}</span>
              <div>
                <p className={`text-sm font-semibold mb-1 ${i === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {s.title}
                </p>
                <p className="label-meta leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Hint block */}
        <div className="mt-8 border border-border p-4">
          <p className="label-meta mb-1" style={{ color: 'var(--lp-accent)' }}>// quickstart</p>
          <p className="font-mono text-xs text-muted-foreground leading-relaxed">
            docker compose up --build<br />
            <span style={{ color: 'var(--syn-cmt)' }}># then connect any GitHub or Azure DevOps repo here</span>
          </p>
        </div>
      </div>

      {/* ── Right col: form ── */}
      <div className="border border-border">
        {/* Form header bar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-card">
          <div style={{ display: 'flex', gap: '5px' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#FF5F57', display: 'block' }} />
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#FEBC2E', display: 'block' }} />
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#28C840', display: 'block' }} />
          </div>
          <span className="font-mono text-xs text-muted-foreground ml-2">connect-repo.ts</span>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Select
              value={form.platform}
              onValueChange={v => setForm(f => ({ ...f, platform: v as any }))}
            >
              <SelectTrigger id="platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="azure">Azure DevOps</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repoUrl">Repository URL</Label>
            <Input
              id="repoUrl"
              placeholder="https://github.com/owner/repo"
              value={form.repoUrl}
              onChange={e => setForm(f => ({ ...f, repoUrl: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="token">Access Token</Label>

            {/* Saved credentials picker */}
            {savedCreds.length > 0 && (
              <div className="flex gap-2 items-center">
                <Select onValueChange={handleSelectCredential}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue placeholder="Use saved credential…" />
                  </SelectTrigger>
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
                {/* Delete button shown after a cred is selected — manage via label */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  title="Manage saved credentials"
                  onClick={() => {
                    const id = savedCreds.find(c => c.token === form.token)?.id
                    if (id) handleDeleteCredential(id)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <Input
              id="token"
              type="password"
              placeholder={form.platform === 'azure' ? 'PAT from dev.azure.com…' : 'ghp_…'}
              value={form.token}
              onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
            />

            {/* Save current token */}
            {form.token && !showSaveInput && (
              <button
                type="button"
                className="label-meta flex items-center gap-1 hover:text-foreground transition-colors"
                onClick={() => setShowSaveInput(true)}
              >
                <Save className="h-3 w-3" /> Save this token
              </button>
            )}
            {showSaveInput && (
              <div className="flex gap-2">
                <Input
                  placeholder="Label, e.g. Ashish Azure PAT"
                  value={saveLabel}
                  onChange={e => setSaveLabel(e.target.value)}
                  className="h-8 text-xs"
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSaveCredential())}
                  autoFocus
                />
                <Button type="button" size="sm" className="h-8 text-xs shrink-0" onClick={handleSaveCredential}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs shrink-0" onClick={() => setShowSaveInput(false)}>
                  Cancel
                </Button>
              </div>
            )}

            <p className="label-meta">Required to post review comments to PRs.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="branches">Branches</Label>
            <Input
              id="branches"
              placeholder="main, develop"
              value={form.branchesInput}
              onChange={e => setForm(f => ({ ...f, branchesInput: e.target.value }))}
            />
            <p className="label-meta">Comma-separated. Defaults to <code className="font-mono">main</code>.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repoPath">
              Local Path <span className="label-meta">(optional)</span>
            </Label>
            <Input
              id="repoPath"
              placeholder="/repos/my-repo  or leave blank to auto-clone"
              value={form.repoPath}
              onChange={e => setForm(f => ({ ...f, repoPath: e.target.value }))}
            />
            <p className="label-meta">
              Leave blank — AgnusAI auto-clones using the token above.
            </p>
          </div>

          {error && (
            <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={loading} className="w-full gap-3 mt-2">
            {loading ? 'Connecting...' : 'Connect Repository'}
            {!loading && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        </form>
      </div>
    </div>
  )
}
