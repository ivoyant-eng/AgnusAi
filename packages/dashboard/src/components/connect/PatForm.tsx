import { useState } from 'react'
import { ArrowRight, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SavedCredential } from '@/types/connect'

interface PatFormState {
  repoUrl: string
  token: string
  repoPath: string
  branchesInput: string
}

interface Props {
  platform: 'github' | 'azure'
  savedCreds: SavedCredential[]
  loading: boolean
  error: string
  onSubmit: (form: PatFormState) => void
  onSaveCredential: (label: string, token: string) => void
  onDeleteCredential: (id: string) => void
}

/**
 * PAT-based repository connect form.
 * Supports selecting/saving/deleting tokens from localStorage.
 */
export function PatForm({
  platform,
  savedCreds,
  loading,
  error,
  onSubmit,
  onSaveCredential,
  onDeleteCredential,
}: Props) {
  const [form, setForm] = useState<PatFormState>({
    repoUrl: '',
    token: '',
    repoPath: '',
    branchesInput: '',
  })
  const [saveLabel, setSaveLabel] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  function patch(partial: Partial<PatFormState>) {
    setForm(f => ({ ...f, ...partial }))
  }

  function handleSelectCred(id: string) {
    const cred = savedCreds.find(c => c.id === id)
    if (cred) patch({ token: cred.token })
  }

  function handleSave() {
    if (!saveLabel.trim() || !form.token) return
    onSaveCredential(saveLabel.trim(), form.token)
    setSaveLabel('')
    setShowSaveInput(false)
  }

  function handleDeleteActive() {
    const id = savedCreds.find(c => c.token === form.token)?.id
    if (id) onDeleteCredential(id)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Repo URL */}
      <div className="space-y-2">
        <Label htmlFor="repoUrl">Repository URL</Label>
        <Input
          id="repoUrl"
          placeholder={
            platform === 'azure'
              ? 'https://dev.azure.com/org/project/_git/repo'
              : 'https://github.com/owner/repo'
          }
          value={form.repoUrl}
          onChange={e => patch({ repoUrl: e.target.value })}
          required
        />
      </div>

      {/* Access token + saved credentials */}
      <div className="space-y-2">
        <Label htmlFor="token">Access Token</Label>

        {savedCreds.length > 0 && (
          <div className="flex gap-2 items-center">
            <Select onValueChange={handleSelectCred}>
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={handleDeleteActive}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <Input
          id="token"
          type="password"
          placeholder={platform === 'azure' ? 'PAT from dev.azure.com…' : 'ghp_…'}
          value={form.token}
          onChange={e => patch({ token: e.target.value })}
        />

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
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSave())}
              autoFocus
            />
            <Button type="button" size="sm" className="h-8 text-xs shrink-0" onClick={handleSave}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs shrink-0"
              onClick={() => setShowSaveInput(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Branches */}
      <div className="space-y-2">
        <Label htmlFor="branches">Branches</Label>
        <Input
          id="branches"
          placeholder="main, develop"
          value={form.branchesInput}
          onChange={e => patch({ branchesInput: e.target.value })}
        />
        <p className="label-meta">
          Comma-separated. Defaults to <code className="font-mono">main</code>.
        </p>
      </div>

      {/* Optional local path */}
      <div className="space-y-2">
        <Label htmlFor="repoPath">
          Local Path <span className="label-meta">(optional)</span>
        </Label>
        <Input
          id="repoPath"
          placeholder="/repos/my-repo  or leave blank to auto-clone"
          value={form.repoPath}
          onChange={e => patch({ repoPath: e.target.value })}
        />
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
  )
}
