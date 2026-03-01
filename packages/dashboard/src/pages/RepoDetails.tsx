import useSWR from 'swr'
import { Link, useParams } from 'react-router-dom'
import { LearningMetrics } from '@/components/LearningMetrics'
import { ConfidenceCalibration } from '@/components/ConfidenceCalibration'
import { AgentTelemetry } from '@/components/AgentTelemetry'
import { RecentReviews } from '@/components/RecentReviews'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

type RepoAnalytics = {
  repo: {
    repoId: string
    repoUrl: string
    platform: 'github' | 'azure'
    indexedAt: string | null
    symbolCount: number
    createdAt: string
  }
  reviews: {
    total: number
    last30Days: number
    avgComments: number
    requestChanges: number
    requestChangesRate: number
  }
  feedback: {
    accepted: number
    rejected: number
    total: number
    acceptanceRate: number
  }
  rules: {
    evaluations: number
    violations: number
    mergedViolations: number
    passRate: number
  }
  agents: {
    runs30Days: number
    avgDurationMs30Days: number
    errors30Days: number
  }
}

type RepoReview = {
  id: string
  prNumber: number
  verdict: 'approve' | 'request_changes' | 'comment'
  commentCount: number
  accepted: number
  rejected: number
  createdAt: string
}

type FeedbackMetrics = {
  repoId: string
  series: Array<{ date: string; accepted: number; rejected: number }>
  totals: { accepted: number; rejected: number; total: number; acceptanceRate: number | null }
}

type PrecisionBucket = {
  bucket: string
  total: number
  accepted: number
  acceptanceRate: number | null
}

type AgentRow = {
  role: string
  runs: number
  avgDurationMs: number
  totalComments: number
  requestChangesCount: number
  errorCount: number
}

type RepoSettings = {
  repoId: string
  prDescription?: {
    effective?: {
      enabled: boolean
      updateMode: 'created_only' | 'created_and_updated'
      publishMode: 'replace_pr' | 'comment'
      preserveOriginal: boolean
      useMarkers: boolean
      publishLabels: boolean
    }
  }
}

export default function RepoDetails() {
  const { repoId = '' } = useParams<{ repoId: string }>()
  const { data: analytics } = useSWR<RepoAnalytics>(repoId ? `/api/repos/${repoId}/analytics` : null, fetcher, { refreshInterval: 30000 })
  const { data: reviews } = useSWR<RepoReview[]>(repoId ? `/api/repos/${repoId}/reviews` : null, fetcher, { refreshInterval: 30000 })
  const { data: telemetry } = useSWR<{ agents: AgentRow[] }>(repoId ? `/api/repos/${repoId}/agent-telemetry?days=30` : null, fetcher, { refreshInterval: 30000 })
  const { data: settings } = useSWR<RepoSettings>(repoId ? `/api/repos/${repoId}/settings` : null, fetcher, { refreshInterval: 60000 })
  const { data: metrics } = useSWR<FeedbackMetrics>(repoId ? `/api/repos/${repoId}/feedback-metrics` : null, fetcher, { refreshInterval: 60000 })
  const { data: precisionData } = useSWR<{ buckets: PrecisionBucket[] }>(repoId ? `/api/repos/${repoId}/precision` : null, fetcher, { refreshInterval: 60000 })

  if (!analytics) {
    return <p className="label-meta text-muted-foreground">Loading repo analytics...</p>
  }

  const repoName = analytics.repo.repoUrl
    .replace('https://github.com/', '')
    .replace('https://dev.azure.com/', '')
  const pr = settings?.prDescription?.effective

  return (
    <div className="space-y-12">
      <section className="space-y-2">
        <Link to="/app" className="label-meta underline hover:text-foreground">
          ← Back to Dashboard
        </Link>
        <h1 className="text-2xl font-semibold">{repoName}</h1>
        <p className="label-meta">{analytics.repo.platform} · added {formatDate(analytics.repo.createdAt)}</p>
      </section>

      <section>
        <p className="label-meta mb-4">Repo Telemetry (30 Days)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric title="Reviews" value={String(analytics.reviews.last30Days)} />
          <Metric title="Acceptance Rate" value={`${Math.round(analytics.feedback.acceptanceRate * 100)}%`} />
          <Metric title="Agent Runs" value={String(analytics.agents.runs30Days)} />
          <Metric title="Avg Agent Time" value={`${analytics.agents.avgDurationMs30Days}ms`} />
          <Metric title="Rule Pass Rate" value={`${Math.round(analytics.rules.passRate * 100)}%`} />
          <Metric title="Merged Violations" value={String(analytics.rules.mergedViolations)} />
          <Metric title="Symbols" value={analytics.repo.symbolCount.toLocaleString()} />
          <Metric title="PR Description" value={pr?.enabled ? 'Enabled' : 'Disabled'} />
        </div>
      </section>

      <section>
        <p className="label-meta mb-4">Repo Settings</p>
        <div className="border border-border">
          <Row k="PR Description Enabled" v={pr?.enabled ? 'Yes' : 'No'} />
          <Row k="Update Mode" v={pr?.updateMode ?? 'created_only'} />
          <Row k="Publish Mode" v={pr?.publishMode ?? 'replace_pr'} />
          <Row k="Preserve Original" v={pr?.preserveOriginal ? 'Yes' : 'No'} />
          <Row k="Use Markers" v={pr?.useMarkers ? 'Yes' : 'No'} />
          <Row k="Publish Labels" v={pr?.publishLabels ? 'Yes' : 'No'} />
        </div>
      </section>

      <LearningMetrics metrics={metrics} />

      <ConfidenceCalibration buckets={precisionData?.buckets ?? []} />

      <AgentTelemetry agents={telemetry?.agents ?? []} />

      <RecentReviews reviews={reviews ?? []} />
    </div>
  )
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="border border-border p-4">
      <p className="label-meta">{title}</p>
      <p className="font-mono text-xl mt-1">{value}</p>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-2 border-b border-border py-3 px-4">
      <span className="label-meta">{k}</span>
      <span className="font-mono text-xs text-right">{v}</span>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}
