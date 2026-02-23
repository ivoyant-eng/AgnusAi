import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function Connect() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    repoUrl: '',
    token: '',
    platform: 'github' as 'github' | 'azure',
    repoPath: '',
    branchesInput: '',
  })

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
    <div className="max-w-2xl">
      {/* Eyebrow */}
      <p className="label-meta mb-4">Connect a Repository</p>

      {/* Display headline */}
      <h1 className="text-[clamp(2.5rem,6vw,5rem)] font-bold leading-none tracking-tight text-foreground mb-12">
        Index.<br />Review.<br />Ship.
      </h1>

      {/* Steps legend */}
      <div className="border-t border-border mb-10">
        {[
          { n: '01', title: 'Connect', desc: 'Enter repo URL and token' },
          { n: '02', title: 'Index', desc: 'Tree-sitter parses your codebase' },
          { n: '03', title: 'Review', desc: 'PRs get graph-aware AI reviews' },
        ].map((s, i) => (
          <div key={s.n} className="flex items-start gap-8 border-b border-border py-4">
            <span className={`num-display w-8 shrink-0 ${i === 0 ? 'text-foreground' : ''}`}>{s.n}</span>
            <div>
              <p className={`font-medium ${i === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{s.title}</p>
              <p className="label-meta mt-0.5">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
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
          <Input
            id="token"
            type="password"
            placeholder="ghp_..."
            value={form.token}
            onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
          />
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
          <Label htmlFor="repoPath">Local Path <span className="label-meta">(optional)</span></Label>
          <Input
            id="repoPath"
            placeholder="/repos/my-repo  or leave blank to auto-clone"
            value={form.repoPath}
            onChange={e => setForm(f => ({ ...f, repoPath: e.target.value }))}
          />
          <p className="label-meta">
            Leave blank — AgnusAI will clone the repo automatically using the token above.
            Provide a path only if you have a pre-existing local clone.
          </p>
        </div>

        {error && (
          <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="gap-3">
          {loading ? 'Connecting...' : 'Connect Repository'}
          {!loading && <ArrowRight className="h-3.5 w-3.5" />}
        </Button>
      </form>
    </div>
  )
}
