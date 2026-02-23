import { useParams } from 'react-router-dom'
import { Copy, CheckCircle } from 'lucide-react'
import { useState } from 'react'
import useSWR from 'swr'
import { Badge } from '@/components/ui/badge'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

interface Repo {
  repoId: string
  platform: 'github' | 'azure'
}

export default function Ready() {
  const { repoId } = useParams<{ repoId: string }>()
  const [copied, setCopied] = useState(false)

  const { data: repos } = useSWR<Repo[]>('/api/repos', fetcher)
  const repo = repos?.find(r => r.repoId === repoId)

  const platform = repo?.platform ?? 'github'
  const webhookPath = platform === 'azure' ? '/api/webhooks/azure' : '/api/webhooks/github'
  const webhookUrl = `${window.location.origin}${webhookPath}`

  const platformLabel = platform === 'azure' ? 'Azure DevOps' : 'GitHub'
  const eventLabel = platform === 'azure'
    ? 'git.push  +  git.pullrequest.created / updated'
    : 'push  +  pull_request'

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-3xl">
      {/* Orange "ready" badge */}
      <Badge className="mb-6">Graph Ready</Badge>

      <h1 className="text-[clamp(2.5rem,6vw,5rem)] font-bold leading-none tracking-tight text-foreground mb-12">
        You're live.
      </h1>

      {/* What happens now */}
      <div className="border-t border-border mb-12">
        {[
          {
            n: '01',
            title: 'Push to any branch',
            desc: 'Webhook triggers incremental re-index of changed files only.',
          },
          {
            n: '02',
            title: 'Open a Pull Request',
            desc: 'AgnusAI fetches the diff, assembles graph context, and posts a review.',
          },
          {
            n: '03',
            title: 'Review comments appear',
            desc: 'Each comment includes caller context and blast radius. Nothing to configure in CI.',
          },
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
        <p className="text-xs text-muted-foreground mb-6 font-mono uppercase tracking-widest">
          {platformLabel}
        </p>
        <p className="text-sm text-muted-foreground mb-6 font-mono">
          Add this URL to your repository's webhook settings.
          Select <strong>{eventLabel}</strong> events.
        </p>

        <div className="flex items-stretch border border-border">
          <div className="flex-1 px-4 py-3 font-mono text-sm text-muted-foreground overflow-x-auto whitespace-nowrap bg-muted/20">
            {webhookUrl}
          </div>
          <button
            onClick={copyWebhook}
            className="flex items-center gap-2 px-4 border-l border-border label-meta hover:bg-muted/30 transition-colors"
          >
            {copied
              ? <><CheckCircle className="h-3.5 w-3.5 text-[#E85A1A]" /> COPIED</>
              : <><Copy className="h-3.5 w-3.5" /> COPY</>
            }
          </button>
        </div>

        <div className="grid grid-cols-2 border-t border-border mt-8">
          <div className="py-4 pr-8 border-r border-border">
            <p className="label-meta">Content type</p>
            <p className="font-mono text-sm mt-1">application/json</p>
          </div>
          <div className="py-4 pl-8">
            <p className="label-meta">Secret</p>
            <p className="font-mono text-sm mt-1">Use value of WEBHOOK_SECRET from .env</p>
          </div>
        </div>
      </section>
    </div>
  )
}
