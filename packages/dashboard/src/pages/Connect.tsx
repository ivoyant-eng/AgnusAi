import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, X, ChevronDown, Key, Puzzle } from 'lucide-react'
import { Label } from '@/components/ui/label'

import { useWebhookConfig } from '@/hooks/useWebhookConfig'
import { useVcsInstallations } from '@/hooks/useVcsInstallations'
import { useRepoPicker } from '@/hooks/useRepoPicker'
import { useSavedCredentials } from '@/hooks/useSavedCredentials'

import { WebhookConfigPanel } from '@/components/connect/WebhookConfigPanel'
import { PlatformSelector } from '@/components/connect/PlatformSelector'
import { AddInstallationForm } from '@/components/connect/AddInstallationForm'
import { InstallationCard } from '@/components/connect/InstallationCard'
import { PatForm } from '@/components/connect/PatForm'

type AccordionSection = 'installation' | 'pat'

export default function Connect() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [platform, setPlatform] = useState<'github' | 'azure'>('github')
  const [oauthSuccess, setOauthSuccess] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState('')
  const [patLoading, setPatLoading] = useState(false)
  const [openSection, setOpenSection] = useState<AccordionSection>('installation')

  // ── Handle OAuth callback query params (?azure_connected / ?azure_error) ──
  useEffect(() => {
    const connected = searchParams.get('azure_connected')
    const oauthError = searchParams.get('azure_error')
    if (connected) {
      setOauthSuccess('Azure DevOps connected successfully!')
      setPlatform('azure')
      setSearchParams({})
    } else if (oauthError) {
      setGlobalError(`Azure OAuth failed: ${oauthError}`)
      setPlatform('azure')
      setSearchParams({})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const webhook = useWebhookConfig(platform)
  const installations = useVcsInstallations(platform)
  const picker = useRepoPicker()
  const savedCreds = useSavedCredentials(platform)

  // Switch to PAT section if there are no installations (first-time users)
  useEffect(() => {
    if (installations.installations.length === 0 && !installations.showAddForm) {
      // keep installation open so they see the empty state and "Add" CTA
    }
  }, [installations.installations.length, installations.showAddForm])

  function toggle(section: AccordionSection) {
    setOpenSection(prev => (prev === section ? section : section))
    setOpenSection(section)
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSaveInstallation(e: React.FormEvent) {
    e.preventDefault()
    await installations.saveInstallation(webhook.redirectUri)
  }

  async function handleReauthorize(instId: string) {
    const inst = installations.installations.find(i => i.id === instId)
    if (!inst) return
    const authUrl = await installations.reauthorize(inst, webhook.redirectUri)
    if (authUrl) {
      window.open(authUrl, '_blank', 'noopener,noreferrer')
    } else {
      setGlobalError('Failed to get authorization URL')
    }
  }

  async function connectViaInstallation(
    instId: string,
    repo: { url: string; fullName: string },
    branches: string[],
  ) {
    picker.patchPicker(instId, { connectError: '', loading: true })
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repoUrl: repo.url, platform, branches, vcsInstallationId: instId }),
      })
      const data = await res.json() as { repoId?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      navigate(`/app/indexing/${data.repoId}?branch=${encodeURIComponent(branches[0])}`)
    } catch (err) {
      picker.patchPicker(instId, { connectError: (err as Error).message })
    } finally {
      picker.patchPicker(instId, { loading: false })
    }
  }

  async function handlePatSubmit(form: {
    repoUrl: string
    token: string
    repoPath: string
    branchesInput: string
  }) {
    setPatLoading(true)
    setGlobalError('')
    try {
      const branches = form.branchesInput
        ? form.branchesInput.split(',').map(s => s.trim()).filter(Boolean)
        : ['main']
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          repoUrl: form.repoUrl,
          platform,
          token: form.token,
          repoPath: form.repoPath || undefined,
          branches,
        }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error ?? 'Request failed')
      }
      const { repoId } = await res.json() as { repoId: string }
      navigate(`/app/indexing/${repoId}?branch=${encodeURIComponent(branches[0])}`)
    } catch (err) {
      setGlobalError((err as Error).message)
    } finally {
      setPatLoading(false)
    }
  }

  const instCount = installations.installations.length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

      {/* ── Left column: steps + webhook config ── */}
      <div>
        <p className="label-meta mb-4">Connect a Repository</p>
        <h1 className="text-[clamp(1.8rem,3.5vw,3rem)] font-bold leading-none tracking-tight text-foreground mb-10">
          Index. Review. Ship.
        </h1>

        <StepList />

        <div className="mt-6">
          <WebhookConfigPanel
            platform={platform}
            webhookUrl={webhook.webhookUrl}
            redirectUri={webhook.redirectUri}
            secretPreview={webhook.secretPreview}
            revealedSecret={webhook.revealedSecret}
            webhookCopied={webhook.webhookCopied}
            secretCopied={webhook.secretCopied}
            rotating={webhook.rotating}
            activeOrgSlug={webhook.activeOrgSlug}
            onCopyWebhook={webhook.copyWebhook}
            onCopySecret={webhook.copySecret}
            onRotateSecret={webhook.rotateSecret}
          />
        </div>
      </div>

      {/* ── Right column: connect form ── */}
      <div className="border border-border">
        {/* Terminal-style titlebar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-card">
          <div style={{ display: 'flex', gap: '5px' }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map(color => (
              <span key={color} style={{ width: 9, height: 9, borderRadius: '50%', background: color, display: 'block' }} />
            ))}
          </div>
          <span className="font-mono text-xs text-muted-foreground ml-2">connect-repo.ts</span>
        </div>

        <div className="p-6 space-y-4">
          {/* OAuth success banner */}
          {oauthSuccess && (
            <div className="border border-green-600 bg-green-50 px-3 py-2.5 flex items-center justify-between gap-3">
              <p className="font-mono text-xs text-green-800">{oauthSuccess}</p>
              <button type="button" onClick={() => setOauthSuccess(null)} className="label-meta hover:text-foreground shrink-0">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Platform selector */}
          <div className="space-y-2">
            <Label>Platform</Label>
            <PlatformSelector value={platform} onChange={setPlatform} />
          </div>

          {/* ── Accordion ── */}
          <div className="border border-border divide-y divide-border">

            {/* Section 1: App Installation */}
            <AccordionItem
              open={openSection === 'installation'}
              onToggle={() => toggle('installation')}
              icon={<Puzzle className="h-3.5 w-3.5" />}
              title={platform === 'github' ? 'GitHub App Installation' : 'Azure DevOps Connection'}
              description={platform === 'github' ? 'Recommended · posts as bot account' : 'Recommended · Entra ID OAuth'}
              badge={instCount > 0 ? String(instCount) : undefined}
            >
              <div className="space-y-3 pt-1">
                {/* Add button */}
                <div className="flex items-center justify-between">
                  <p className="label-meta">
                    {instCount === 0
                      ? platform === 'github' ? 'No installations yet.' : 'No connections yet.'
                      : platform === 'github' ? `${instCount} installation${instCount > 1 ? 's' : ''}` : `${instCount} connection${instCount > 1 ? 's' : ''}`}
                  </p>
                  <button
                    type="button"
                    onClick={installations.showAddForm ? installations.closeAddForm : installations.openAddForm}
                    className="flex items-center gap-1 label-meta hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {installations.showAddForm ? 'Cancel' : platform === 'github' ? 'Add' : 'Add'}
                  </button>
                </div>

                {/* Add form */}
                {installations.showAddForm && (
                  <AddInstallationForm
                    platform={platform}
                    form={installations.addForm}
                    saving={installations.addSaving}
                    error={installations.addError}
                    redirectUri={webhook.redirectUri}
                    onChange={patch => installations.setAddForm(f => ({ ...f, ...patch }))}
                    onSubmit={handleSaveInstallation}
                    onCancel={installations.closeAddForm}
                  />
                )}

                {/* Empty CTA */}
                {instCount === 0 && !installations.showAddForm && (
                  <button
                    type="button"
                    onClick={installations.openAddForm}
                    className="w-full border border-dashed border-border py-4 font-mono text-xs text-muted-foreground hover:text-[#E85A1A] hover:border-[#E85A1A]/50 transition-colors"
                  >
                    {platform === 'github' ? '+ Set up a GitHub App →' : '+ Add Azure DevOps connection →'}
                  </button>
                )}

                {/* Installation cards */}
                {installations.installations.map(inst => (
                  <InstallationCard
                    key={inst.id}
                    inst={inst}
                    ps={picker.getPicker(inst.id)}
                    pickerRef={el => picker.setPickerRef(inst.id, el)}
                    onFetch={() => picker.fetchRepos(inst.id)}
                    onPickerToggle={() => {
                      const ps = picker.getPicker(inst.id)
                      picker.patchPicker(inst.id, { open: !ps.open, search: '' })
                    }}
                    onSearch={s => picker.patchPicker(inst.id, { search: s })}
                    onSelect={repo => picker.patchPicker(inst.id, { selected: repo, open: false, search: '' })}
                    onRemove={() => installations.removeInstallation(inst.id)}
                    onConnect={(repo, branches) => connectViaInstallation(inst.id, repo, branches)}
                    onReauthorize={() => handleReauthorize(inst.id)}
                  />
                ))}
              </div>
            </AccordionItem>

            {/* Section 2: PAT */}
            <AccordionItem
              open={openSection === 'pat'}
              onToggle={() => toggle('pat')}
              icon={<Key className="h-3.5 w-3.5" />}
              title="Personal Access Token"
              description="Quick setup · reviews post as your user"
            >
              <PatForm
                platform={platform}
                savedCreds={savedCreds.creds}
                loading={patLoading}
                error={globalError}
                onSubmit={handlePatSubmit}
                onSaveCredential={savedCreds.save}
                onDeleteCredential={savedCreds.remove}
              />
            </AccordionItem>

          </div>
        </div>
      </div>
    </div>
  )
}

// ── Accordion item ────────────────────────────────────────────────────────────

interface AccordionItemProps {
  open: boolean
  onToggle: () => void
  icon: React.ReactNode
  title: string
  description: string
  badge?: string
  children: React.ReactNode
}

function AccordionItem({ open, onToggle, icon, title, description, badge, children }: AccordionItemProps) {
  return (
    <div>
      {/* Header button */}
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-4 py-3.5 text-left transition-colors group ${
          open ? 'bg-muted/10' : 'hover:bg-muted/5'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 transition-colors ${open ? 'text-[#E85A1A]' : 'text-muted-foreground group-hover:text-foreground'}`}>
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-mono text-xs font-semibold tracking-wide transition-colors ${open ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>
                {title}
              </span>
              {badge && (
                <span className="font-mono text-xs px-1.5 py-0.5 bg-[#E85A1A]/10 text-[#E85A1A] border border-[#E85A1A]/20 leading-none">
                  {badge}
                </span>
              )}
            </div>
            <p className="label-meta text-xs truncate mt-0.5">{description}</p>
          </div>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 ml-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Animated content panel using CSS grid trick */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className={open ? 'overflow-visible' : 'overflow-hidden'}>
          <div className={`px-4 pb-4 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Static 3-step explainer ───────────────────────────────────────────────────

function StepList() {
  const steps = [
    { n: '01', title: 'Connect', desc: 'Pick a repo from your saved GitHub App installation. Ryv uses it to clone and post review comments.' },
    { n: '02', title: 'Index', desc: 'Tree-sitter WASM parses every file. Symbols and call edges go into Postgres + pgvector.' },
    { n: '03', title: 'Review', desc: 'Every PR webhook triggers a 2-hop BFS. Blast radius is surfaced to the LLM before it writes a single comment.' },
  ]
  return (
    <div className="border-t border-border">
      {steps.map((s, i) => (
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
  )
}
