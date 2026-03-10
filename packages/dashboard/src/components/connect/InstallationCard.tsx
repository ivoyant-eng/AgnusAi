import { useState, useEffect } from 'react'
import { CheckCircle, ChevronDown, RefreshCw, ArrowRight, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import type { VcsInstallation, AppRepo, PickerState } from '@/types/connect'

interface Props {
  inst: VcsInstallation
  ps: PickerState
  pickerRef: (el: HTMLDivElement | null) => void
  onFetch: () => void
  onPickerToggle: () => void
  onSearch: (s: string) => void
  onSelect: (repo: AppRepo) => void
  onRemove: () => void
  onConnect: (repo: AppRepo, branches: string[]) => void
  onReauthorize: () => void
}

/**
 * Card for a single saved VCS installation.
 * Shows identity info, Azure OAuth status, repo picker dropdown, and branch/connect controls.
 */
export function InstallationCard({
  inst,
  ps,
  pickerRef,
  onFetch,
  onPickerToggle,
  onSearch,
  onSelect,
  onRemove,
  onConnect,
  onReauthorize,
}: Props) {
  const [branchInput, setBranchInput] = useState('master')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const displayName =
    inst.display_name ??
    inst.account_login ??
    (inst.platform === 'azure' ? inst.azure_org_url ?? 'Azure DevOps' : `App #${inst.github_app_id}`)

  const accountLabel = inst.account_type ?? null
  const azureConnected = inst.platform === 'azure' && inst.azure_connected

  // Auto-fetch repos on mount if none loaded yet
  useEffect(() => {
    if (ps.repos.length === 0 && !ps.loading && !ps.error) {
      onFetch()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst.id])

  return (
    <div className="border border-border p-4 space-y-3">
      {/* Header — name, type badge, Azure status badge, delete button */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CheckCircle
              className={`h-3.5 w-3.5 shrink-0 ${
                inst.platform === 'azure' && !azureConnected
                  ? 'text-muted-foreground'
                  : 'text-[#E85A1A]'
              }`}
            />
            <span className="font-mono text-sm font-semibold text-foreground">{displayName}</span>
            {accountLabel && <span className="label-meta shrink-0">{accountLabel}</span>}
            {inst.platform === 'azure' && (
              <span
                className={`font-mono text-xs px-1.5 py-0.5 border whitespace-nowrap shrink-0 ${
                  azureConnected
                    ? 'border-green-600 text-green-700'
                    : 'border-[#E85A1A] text-[#E85A1A]'
                }`}
              >
                {azureConnected ? 'connected' : 'auth required'}
              </span>
            )}
          </div>
          <p className="label-meta mt-0.5 ml-5 truncate">
            {inst.platform === 'azure'
              ? `${inst.azure_org_url} · App ${inst.azure_client_id?.slice(0, 8)}…`
              : `App #${inst.github_app_id} · Installation ${inst.github_app_installation_id}`}
          </p>
        </div>

        {/* Trash icon — opens confirmation dialog */}
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="text-destructive/60 hover:text-destructive transition-colors shrink-0 p-1 -mr-1"
          title="Remove this connection"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <DialogTitle>Remove {inst.platform === 'azure' ? 'connection' : 'installation'}?</DialogTitle>
            </div>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              <span className="block mb-3">
                You're about to remove{' '}
                <span className="font-mono text-foreground">{displayName}</span>.
              </span>
              <ul className="space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="text-destructive mt-0.5">·</span>
                  <span>Stored credentials (
                    {inst.platform === 'azure' ? 'client secret + OAuth tokens' : 'private key'}
                    ) will be permanently deleted.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5">·</span>
                  <span>Repositories connected via this {inst.platform === 'azure' ? 'connection' : 'installation'} will keep their existing index but won't receive new reviews until reconnected.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5">·</span>
                  <span>This action cannot be undone.</span>
                </li>
              </ul>
            </DialogDescription>
          </DialogBody>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              Cancel
            </button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setConfirmOpen(false); onRemove() }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Remove {inst.platform === 'azure' ? 'connection' : 'installation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Azure: prompt to authorize if not yet connected */}
      {inst.platform === 'azure' && !azureConnected && (
        <div className="border border-[#E85A1A]/40 bg-[#E85A1A]/5 px-3 py-2.5 space-y-2">
          <p className="font-mono text-xs text-muted-foreground">
            OAuth authorization required. Sign in with your Azure service/bot account.
          </p>
          <button
            type="button"
            className="font-mono text-xs bg-[#E85A1A] text-white px-2.5 py-1 hover:bg-[#c94d17] transition-colors"
            onClick={onReauthorize}
          >
            Authorize with Microsoft →
          </button>
        </div>
      )}

      {/* Repo picker dropdown */}
      <RepoPicker
        inst={inst}
        ps={ps}
        pickerRef={pickerRef}
        onToggle={onPickerToggle}
        onSearch={onSearch}
        onSelect={onSelect}
        onRefresh={onFetch}
        suppressError={inst.platform === 'azure' && !azureConnected}
      />

      {/* Branch + connect */}
      {ps.selected && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`branch-${inst.id}`} className="text-xs">Branch</Label>
              <Input
                id={`branch-${inst.id}`}
                placeholder="master"
                value={branchInput}
                onChange={e => setBranchInput(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="pt-5">
              <Button
                size="sm"
                disabled={ps.loading || !branchInput}
                onClick={() =>
                  onConnect(
                    ps.selected!,
                    branchInput.split(',').map(s => s.trim()).filter(Boolean),
                  )
                }
              >
                {ps.loading ? 'Connecting…' : 'Connect'}
                {!ps.loading && <ArrowRight className="h-3 w-3 ml-1.5" />}
              </Button>
            </div>
          </div>
          {ps.connectError && (
            <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">
              {ps.connectError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Dropdown that lists repos accessible to an installation */
function RepoPicker({
  inst,
  ps,
  pickerRef,
  onToggle,
  onSearch,
  onSelect,
  onRefresh,
  suppressError,
}: {
  inst: VcsInstallation
  ps: PickerState
  pickerRef: (el: HTMLDivElement | null) => void
  onToggle: () => void
  onSearch: (s: string) => void
  onSelect: (repo: AppRepo) => void
  onRefresh: () => void
  suppressError?: boolean
}) {
  const filtered = ps.repos.filter(r =>
    r.fullName.toLowerCase().includes(ps.search.toLowerCase()),
  )

  return (
    <div ref={pickerRef} className="relative">
      {/* Trigger */}
      <div
        className="flex items-center border border-border cursor-pointer hover:bg-muted/10 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 px-3 py-2.5 font-mono text-sm truncate">
          {ps.loading ? (
            <span className="text-muted-foreground">Loading repositories…</span>
          ) : ps.selected ? (
            <span className="text-foreground">{ps.selected.fullName}</span>
          ) : (
            <span className="text-muted-foreground">Select a repository…</span>
          )}
        </div>
        <span className="px-3 label-meta">
          {ps.loading ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </span>
      </div>

      {/* Dropdown */}
      {ps.open && (
        <div className="absolute z-50 w-full border border-border bg-card shadow-md mt-px max-h-64 flex flex-col">
          <div className="border-b border-border px-3 py-2">
            <input
              autoFocus
              className="w-full bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              placeholder="Search repositories…"
              value={ps.search}
              onChange={e => onSearch(e.target.value)}
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && !ps.loading && (
              <div className="px-3 py-3 space-y-1">
                <p className="label-meta">No repositories found.</p>
                {inst.platform === 'github' && ps.meta?.repositorySelection === 'selected' && (
                  <p className="font-mono text-xs text-muted-foreground">
                    Installation is set to{' '}
                    <span className="text-foreground">selected repos only</span>. Add repos at
                    github.com/settings/installations.
                  </p>
                )}
              </div>
            )}
            {filtered.map(repo => (
              <div
                key={repo.id}
                onClick={() => onSelect(repo)}
                className={`flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors ${
                  ps.selected?.id === repo.id ? 'bg-muted/20' : ''
                }`}
              >
                <span className="font-mono text-xs text-foreground truncate">{repo.fullName}</span>
                {repo.private && <span className="label-meta ml-2 shrink-0">private</span>}
              </div>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2 flex items-center justify-between">
            <span className="label-meta">{ps.repos.length} repos</span>
            {ps.meta?.accountLogin && (
              <span className="font-mono text-xs text-muted-foreground">
                {ps.meta.accountLogin} ·{' '}
                {ps.meta.repositorySelection === 'all' ? 'all repos' : 'selected repos'}
              </span>
            )}
          </div>
        </div>
      )}

      {ps.error && !suppressError && (
        <p className="mt-1 font-mono text-xs text-destructive">{ps.error}</p>
      )}

      <button
        type="button"
        onClick={onRefresh}
        disabled={ps.loading}
        className="mt-1.5 flex items-center gap-1.5 label-meta hover:text-foreground transition-colors disabled:opacity-40"
      >
        <RefreshCw className={`h-3 w-3 ${ps.loading ? 'animate-spin' : ''}`} />
        {ps.repos.length > 0 ? 'Refresh list' : 'Fetch repositories'}
      </button>
    </div>
  )
}
