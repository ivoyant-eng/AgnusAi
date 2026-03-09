import { useParams, Link } from 'react-router-dom'
import { Copy, CheckCircle, Check } from 'lucide-react'
import { useState } from 'react'
import useSWR from 'swr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { PemUpload } from '@/components/PemUpload'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

interface Repo {
  repoId: string
  platform: 'github' | 'azure'
  githubAppId?: string | null
  githubAppInstallationId?: string | null
  vcsInstallationId?: string | null
}

interface WebhookSecret {
  platform: string
  secretPreview: string
  path: string
}

function CopyButton({ text, label = 'COPY' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-2 px-4 border-l border-border label-meta hover:bg-muted/30 transition-colors shrink-0"
    >
      {copied
        ? <><CheckCircle className="h-3.5 w-3.5 text-[#E85A1A]" /> COPIED</>
        : <><Copy className="h-3.5 w-3.5" /> {label}</>
      }
    </button>
  )
}

function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-stretch border border-border">
      <div className="flex-1 px-4 py-3 font-mono text-sm text-muted-foreground overflow-x-auto whitespace-nowrap bg-muted/20">
        {value}
      </div>
      <CopyButton text={value} />
    </div>
  )
}

function StepCheck({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-5 h-5 border shrink-0 flex items-center justify-center transition-colors ${done ? 'bg-foreground border-foreground' : 'border-border hover:border-foreground'}`}
      aria-label="Mark step complete"
    >
      {done && <Check className="h-3 w-3 text-background" />}
    </button>
  )
}

export default function Ready() {
  const { repoId } = useParams<{ repoId: string }>()
  const { user } = useAuth()

  const { data: repos } = useSWR<Repo[]>('/api/repos', fetcher)
  const repo = repos?.find(r => r.repoId === repoId)
  const platform = repo?.platform ?? 'github'

  // Skip wizard if App credentials already exist on this repo
  const appAlreadyActive = Boolean(repo?.githubAppId && repo?.githubAppInstallationId)

  const activeOrgSlug = user?.orgs?.find((o: any) => o.orgId === user.activeOrgId)?.slug
  const webhookPath = platform === 'azure'
    ? (activeOrgSlug ? `/api/webhooks/azure/${activeOrgSlug}` : '/api/webhooks/azure')
    : (activeOrgSlug ? `/api/webhooks/github/${activeOrgSlug}` : '/api/webhooks/github')
  const webhookUrl = `${window.location.origin}${webhookPath}`

  // Fetch org webhook secret for GitHub wizard
  const { data: webhookData } = useSWR<{ webhooks: WebhookSecret[] }>(
    activeOrgSlug ? `/api/orgs/${activeOrgSlug}/webhooks` : null,
    fetcher
  )
  const githubWebhookSecret = webhookData?.webhooks?.find(w => w.platform === 'github')?.secretPreview ?? '(configure WEBHOOK_SECRET in .env)'

  // Wizard step checks — GitHub only
  const [stepsChecked, setStepsChecked] = useState([false, false, false])
  function toggleStep(i: number) {
    setStepsChecked(prev => prev.map((v, idx) => idx === i ? !v : v))
  }

  // GitHub App credential form (step 3)
  const [appForm, setAppForm] = useState({ appId: '', privateKey: '', installationId: '' })
  const [appSaving, setAppSaving] = useState(false)
  const [appError, setAppError] = useState('')
  const [appSuccess, setAppSuccess] = useState(false)

  async function handleSaveAppCreds(e: React.FormEvent) {
    e.preventDefault()
    if (!repoId) return
    setAppSaving(true)
    setAppError('')
    setAppSuccess(false)
    try {
      const res = await fetch(`/api/repos/${repoId}/github-app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          appId: appForm.appId,
          privateKey: appForm.privateKey,
          installationId: appForm.installationId,
        }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error ?? 'Request failed')
      }
      setAppSuccess(true)
      toggleStep(2)
    } catch (err) {
      setAppError((err as Error).message)
    } finally {
      setAppSaving(false)
    }
  }

  const ryvInstanceUrl = window.location.origin

  if (platform === 'github') {
    // Already configured — skip wizard entirely
    if (appAlreadyActive) {
      return (
        <div className="max-w-3xl">
          <Badge className="mb-6">Graph Ready</Badge>
          <h1 className="text-[clamp(2.5rem,6vw,5rem)] font-bold leading-none tracking-tight text-foreground mb-4">
            You're live.
          </h1>
          <div className="flex items-center gap-3 border border-border px-5 py-4 mb-8">
            <CheckCircle className="h-5 w-5 text-[#E85A1A] shrink-0" />
            <div>
              <p className="font-semibold text-sm">Bot identity active</p>
              <p className="label-meta mt-0.5">Reviews will post as your GitHub App. Open a pull request and Ryv will review it automatically.</p>
            </div>
          </div>
          <Link to="/app" className="label-meta hover:text-foreground transition-colors flex items-center gap-1">
            → Go to dashboard
          </Link>
        </div>
      )
    }

    return (
      <div className="max-w-3xl">
        <Badge className="mb-6">Graph Ready</Badge>
        <h1 className="text-[clamp(2.5rem,6vw,5rem)] font-bold leading-none tracking-tight text-foreground mb-4">
          You're live.
        </h1>
        <p className="label-meta mb-12">Complete the steps below to activate GitHub App bot identity for this repository.</p>

        {/* Step 1 — Create GitHub App */}
        <div className="border-t border-border">
          <div className="flex items-start gap-6 border-b border-border py-6">
            <div className="flex flex-col items-center gap-3 pt-0.5">
              <span className="num-display w-8 shrink-0 text-center">01</span>
              <StepCheck done={stepsChecked[0]} onClick={() => toggleStep(0)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold mb-3">Create a GitHub App</p>
              <p className="label-meta mb-4">
                Go to your GitHub organization settings and create a new App. Use the values below.
              </p>
              <a
                href={`https://github.com/organizations/${activeOrgSlug ?? 'YOUR_ORG'}/settings/apps/new`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-mono text-xs border border-border px-4 py-2 hover:bg-muted/30 transition-colors mb-5"
              >
                Open GitHub → New App
              </a>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="label-meta mb-1">App name</p>
                  <CopyField value="Ryv" />
                </div>
                <div>
                  <p className="label-meta mb-1">Homepage URL</p>
                  <CopyField value={ryvInstanceUrl} />
                </div>
                <div>
                  <p className="label-meta mb-1">Webhook URL</p>
                  <CopyField value={webhookUrl} />
                </div>
                <div>
                  <p className="label-meta mb-1">Webhook secret</p>
                  <CopyField value={githubWebhookSecret} />
                </div>
              </div>
              <div className="mt-5 border border-border p-4 space-y-1">
                <p className="label-meta mb-2">Required permissions</p>
                {[
                  ['Contents', 'Read & Write'],
                  ['Pull requests', 'Read & Write'],
                  ['Issues', 'Read & Write'],
                  ['Checks', 'Read-only'],
                  ['Metadata', 'Read-only'],
                ].map(([scope, access]) => (
                  <div key={scope} className="flex items-center justify-between font-mono text-xs">
                    <span className="text-muted-foreground">{scope}</span>
                    <span className={access === 'Read & Write' ? 'text-foreground' : 'text-muted-foreground'}>{access}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-border mt-2">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="text-muted-foreground">Subscribe to events</span>
                    <span className="text-foreground">Pull request</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 2 — Install the App */}
          <div className="flex items-start gap-6 border-b border-border py-6">
            <div className="flex flex-col items-center gap-3 pt-0.5">
              <span className="num-display w-8 shrink-0 text-center">02</span>
              <StepCheck done={stepsChecked[1]} onClick={() => toggleStep(1)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold mb-3">Install the App on your repositories</p>
              <p className="label-meta mb-4">
                After creating the App, go to its Install page. Choose <strong>Only select repositories</strong> and add this repo.
              </p>
              <p className="label-meta leading-relaxed">
                After installing, GitHub redirects you to a URL like{' '}
                <span className="font-mono">github.com/settings/installations/<strong>78901234</strong></span>
                {' '}— that trailing number is your Installation ID. It identifies <em>which account</em> installed
                the App so Ryv can generate auth tokens scoped to your org only.
              </p>
            </div>
          </div>

          {/* Step 3 — Enter App credentials */}
          <div className="flex items-start gap-6 border-b border-border py-6">
            <div className="flex flex-col items-center gap-3 pt-0.5">
              <span className="num-display w-8 shrink-0 text-center">03</span>
              <StepCheck done={stepsChecked[2]} onClick={() => toggleStep(2)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold mb-3">Enter App credentials in Ryv</p>
              {appSuccess ? (
                <div className="flex items-center gap-2 text-sm font-mono border border-border px-4 py-3">
                  <CheckCircle className="h-4 w-4 text-[#E85A1A]" />
                  Bot identity active — reviews will now post as your GitHub App.
                </div>
              ) : (
                <form onSubmit={handleSaveAppCreds} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="w-appId">App ID</Label>
                    <Input
                      id="w-appId"
                      type="number"
                      placeholder="123456"
                      value={appForm.appId}
                      onChange={e => setAppForm(f => ({ ...f, appId: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Private Key (.pem)</Label>
                    <PemUpload
                      value={appForm.privateKey}
                      onChange={pem => setAppForm(f => ({ ...f, privateKey: pem }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="w-installId">Installation ID</Label>
                    <Input
                      id="w-installId"
                      type="number"
                      placeholder="78901234"
                      value={appForm.installationId}
                      onChange={e => setAppForm(f => ({ ...f, installationId: e.target.value }))}
                      required
                    />
                  </div>
                  {appError && (
                    <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">{appError}</p>
                  )}
                  <Button type="submit" disabled={appSaving} size="sm">
                    {appSaving ? 'Saving…' : 'Save App credentials'}
                  </Button>
                </form>
              )}
            </div>
          </div>

          {/* Step 4 — Done */}
          <div className="flex items-start gap-6 py-6">
            <span className="num-display w-8 shrink-0">04</span>
            <div>
              <p className="font-semibold mb-2">Done</p>
              <p className="label-meta mb-4">Open a pull request and Ryv will review it automatically.</p>
              <Link to="/app" className="label-meta hover:text-foreground transition-colors flex items-center gap-1">
                → Go to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Azure platform ──────────────────────────────────────────────────────────
  const platformLabel = 'Azure DevOps'
  const eventLabel = 'git.push  +  git.pullrequest.created / updated'

  return (
    <div className="max-w-3xl">
      <Badge className="mb-6">Graph Ready</Badge>
      <h1 className="text-[clamp(2.5rem,6vw,5rem)] font-bold leading-none tracking-tight text-foreground mb-12">
        You're live.
      </h1>

      {/* What happens now */}
      <div className="border-t border-border mb-12">
        {[
          { n: '01', title: 'Push to any branch', desc: 'Webhook triggers incremental re-index of changed files only.' },
          { n: '02', title: 'Open a Pull Request', desc: 'Ryv fetches the diff, assembles graph context, and posts a review.' },
          { n: '03', title: 'Review comments appear', desc: 'Each comment includes caller context and blast radius. Nothing to configure in CI.' },
        ].map(s => (
          <div key={s.n} className="flex items-start gap-8 border-b border-border py-6">
            <span className="num-display w-8 shrink-0">{s.n}</span>
            <div>
              <p className="font-semibold">{s.title}</p>
              <p className="label-meta mt-1">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Webhook setup */}
      <section>
        <p className="label-meta mb-1">Webhook Configuration</p>
        <p className="text-xs text-muted-foreground mb-6 font-mono uppercase tracking-widest">{platformLabel}</p>
        <p className="text-sm text-muted-foreground mb-6 font-mono">
          Add this URL to your repository's webhook settings.
          Select <strong>{eventLabel}</strong> events.
        </p>
        <CopyField value={webhookUrl} />
        <div className="grid grid-cols-2 border-t border-border mt-8">
          <div className="py-4 pr-8 border-r border-border">
            <p className="label-meta">Content type</p>
            <p className="font-mono text-sm mt-1">application/json</p>
          </div>
          <div className="py-4 pl-8">
            <p className="label-meta">Secret</p>
            <p className="font-mono text-sm mt-1">Set header X-Webhook-Secret to your webhook secret</p>
          </div>
        </div>

        {/* Azure PAT guide */}
        <div className="mt-10 border border-border p-5 space-y-3">
          <p className="label-meta" style={{ color: 'var(--lp-accent)' }}>// PAT scopes required</p>
          {[
            ['Code', 'Read'],
            ['Pull Request Threads', 'Read & Write'],
          ].map(([scope, access]) => (
            <div key={scope} className="flex items-center justify-between font-mono text-xs">
              <span className="text-muted-foreground">{scope}</span>
              <span className="text-foreground">{access}</span>
            </div>
          ))}
          <p className="label-meta pt-2 border-t border-border mt-2">
            In Azure DevOps: Project Settings → Service Hooks → Create subscription → Web Hooks → select{' '}
            <strong>Pull request created</strong> and <strong>Pull request updated</strong> events.
          </p>
        </div>
      </section>
    </div>
  )
}
