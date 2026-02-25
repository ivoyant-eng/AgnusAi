import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Link, useNavigate } from 'react-router-dom'
import { Trash2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FeedbackChart } from '@/components/FeedbackChart'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Repo {
  repoId: string
  repoUrl: string
  platform: 'github' | 'azure'
  repoPath: string | null
  indexedAt: string | null
  symbolCount: number
  createdAt: string
}

interface Review {
  id: string
  repoId: string
  repoUrl: string
  prNumber: number
  verdict: 'approve' | 'request_changes' | 'comment'
  commentCount: number
  riskScore: number
  createdAt: string
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

const VERDICT_LABEL: Record<string, string> = {
  approve: 'Approved',
  request_changes: 'Changes Requested',
  comment: 'Comment',
}

const VERDICT_COLOR: Record<string, string> = {
  approve: 'text-[#E85A1A]',
  request_changes: 'text-foreground',
  comment: 'text-muted-foreground',
}

interface FeedbackMetrics {
  repoId: string
  series: Array<{ date: string; accepted: number; rejected: number }>
  totals: { accepted: number; rejected: number; total: number; acceptanceRate: number | null }
}

interface PrecisionBucket {
  bucket: string
  total: number
  accepted: number
  acceptanceRate: number | null
}

export default function Dashboard() {
  const { data: repos, mutate: mutateRepos } = useSWR<Repo[]>('/api/repos', fetcher, { refreshInterval: 30000 })
  const { data: reviews } = useSWR<Review[]>('/api/reviews', fetcher, { refreshInterval: 30000 })
  const navigate = useNavigate()

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)

  // Default to first repo once repos load
  useEffect(() => {
    if (repos && repos.length > 0 && !selectedRepoId) {
      setSelectedRepoId(repos[0].repoId)
    }
  }, [repos, selectedRepoId])

  const { data: metrics } = useSWR<FeedbackMetrics>(
    selectedRepoId ? `/api/repos/${selectedRepoId}/feedback-metrics` : null,
    fetcher,
    { refreshInterval: 60000 },
  )

  const { data: precisionData } = useSWR<{ buckets: PrecisionBucket[] }>(
    selectedRepoId ? `/api/repos/${selectedRepoId}/precision` : null,
    fetcher,
    { refreshInterval: 60000 },
  )

  const hasData = repos && repos.length > 0

  async function handleDelete(repoId: string, repoUrl: string) {
    const name = repoUrl.replace('https://github.com/', '').replace('https://dev.azure.com/', '')
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    await fetch(`/api/repos/${repoId}`, { method: 'DELETE', credentials: 'include' })
    mutateRepos()
  }

  async function handleReindex(repoId: string) {
    const res = await fetch(`/api/repos/${repoId}/reindex`, { method: 'POST', credentials: 'include' })
    const data = await res.json() as { branches?: string[] }
    const branch = data.branches?.[0] ?? 'main'
    navigate(`/app/indexing/${repoId}?branch=${encodeURIComponent(branch)}`)
  }

  return (
    <div>
      {!hasData ? (
        <EmptyState />
      ) : (
        <div className="space-y-16">
          {/* Repos section */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <p className="label-meta">Repositories</p>
              <Link
                to="/app/connect"
                className="label-meta hover:text-foreground transition-colors underline"
              >
                + Add Repo
              </Link>
            </div>
            <div className="border-t border-border">
              {repos.map((repo, i) => (
                <div key={repo.repoId} className="flex items-center gap-6 border-b border-border py-5 hover:bg-muted/20 transition-colors">
                  <span className="num-display w-8 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {repo.repoUrl.replace('https://github.com/', '').replace('https://dev.azure.com/', '')}
                    </p>
                    <p className="label-meta mt-0.5">{repo.platform} · added {formatDate(repo.createdAt)}</p>
                  </div>

                  {/* Index status badge */}
                  <IndexStatus indexedAt={repo.indexedAt} symbolCount={repo.symbolCount} />

                  {/* View setup link */}
                  <Link
                    to={`/app/ready/${repo.repoId}`}
                    className="label-meta hover:text-foreground transition-colors underline shrink-0 hidden sm:block"
                  >
                    Setup
                  </Link>

                  {/* Reindex */}
                  <button
                    onClick={() => handleReindex(repo.repoId)}
                    title="Reindex"
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(repo.repoId, repo.repoUrl)}
                    title="Delete repo"
                    className="p-1.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Learning Metrics section */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <p className="label-meta">Learning Metrics</p>
              {repos && repos.length > 1 && (
                <Select value={selectedRepoId ?? ''} onValueChange={setSelectedRepoId}>
                  <SelectTrigger className="w-56 h-8 text-xs overflow-hidden">
                    <span className="truncate min-w-0 flex-1 text-left">
                      <SelectValue placeholder="Select repo" />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map(r => (
                      <SelectItem key={r.repoId} value={r.repoId}>
                        <span className="block truncate max-w-[240px]">
                          {r.repoUrl.replace('https://github.com/', '').replace('https://dev.azure.com/', '')}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {metrics ? (
              <FeedbackChart series={metrics.series} totals={metrics.totals} />
            ) : (
              <div className="border border-border py-12 text-center">
                <p className="label-meta text-muted-foreground">Loading…</p>
              </div>
            )}
            {precisionData && precisionData.buckets.length > 0 && (
              <div className="mt-8">
                <p className="label-meta mb-4">Confidence Calibration</p>
                <div className="border-t border-border">
                  <div className="grid grid-cols-3 border-b border-border py-2">
                    <span className="label-meta">Confidence</span>
                    <span className="label-meta text-right">Comments</span>
                    <span className="label-meta text-right">Acceptance</span>
                  </div>
                  {precisionData.buckets.map(b => (
                    <div key={b.bucket} className="grid grid-cols-3 border-b border-border py-3">
                      <span className="font-mono text-xs">{b.bucket}</span>
                      <span className="font-mono text-xs text-right">{b.total}</span>
                      <span className="font-mono text-xs text-right">
                        {b.acceptanceRate !== null ? `${b.acceptanceRate}%` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Reviews table */}
          <section>
            <p className="label-meta mb-6">Recent Reviews</p>

            {/* Header row */}
            <div className="grid grid-cols-[2rem_1fr_6rem_5rem_8rem] gap-4 border-t border-b border-border py-2 items-center">
              <span className="label-meta">#</span>
              <span className="label-meta">Pull Request</span>
              <span className="label-meta text-right">Comments</span>
              <span className="label-meta">Verdict</span>
              <span className="label-meta text-right">Date</span>
            </div>

            {reviews && reviews.length > 0 ? (
              reviews.map((r, i) => (
                <div
                  key={r.id}
                  className="grid grid-cols-[2rem_1fr_6rem_5rem_8rem] gap-4 border-b border-border py-4 items-center hover:bg-muted/20 transition-colors"
                >
                  <span className="num-display">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm">
                      {r.repoUrl.split('/').slice(-2).join('/')} #{r.prNumber}
                    </p>
                  </div>
                  <span className="font-mono text-sm text-right">{r.commentCount}</span>
                  <span className={cn('label-meta', VERDICT_COLOR[r.verdict])}>
                    {VERDICT_LABEL[r.verdict] ?? r.verdict}
                  </span>
                  <span className="label-meta text-right">{formatDate(r.createdAt)}</span>
                </div>
              ))
            ) : (
              <div className="py-16 text-center">
                <p className="label-meta">No reviews yet — open a PR to trigger the first review.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function IndexStatus({ indexedAt, symbolCount }: { indexedAt: string | null; symbolCount: number }) {
  if (indexedAt) {
    return (
      <span className="label-meta text-[#E85A1A] shrink-0 hidden md:block">
        ✓ {symbolCount.toLocaleString()} symbols
      </span>
    )
  }
  return (
    <span className="label-meta text-muted-foreground shrink-0 hidden md:block">
      NOT INDEXED
    </span>
  )
}

function EmptyState() {
  return (
    <div className="max-w-2xl">
      <p className="label-meta mb-4">Dashboard</p>

      <h1 className="text-[clamp(3rem,8vw,7rem)] font-bold leading-none tracking-tight text-foreground mb-8">
        No repos<br />yet.
      </h1>

      <p className="font-mono text-sm text-muted-foreground mb-12">
        Connect a repository to start getting graph-aware PR reviews.
        No CI configuration required.
      </p>

      <div className="border-t border-border mb-8">
        {[
          { n: '01', title: 'Connect Repo', desc: 'Add your GitHub or Azure DevOps repo' },
          { n: '02', title: 'Index Codebase', desc: 'Tree-sitter builds a symbol dependency graph' },
          { n: '03', title: 'Get Reviews', desc: 'Every PR receives blast-radius-aware comments' },
        ].map(s => (
          <div key={s.n} className="flex items-start gap-8 border-b border-border py-5">
            <span className="num-display w-8 shrink-0">{s.n}</span>
            <div>
              <p className="font-medium">{s.title}</p>
              <p className="label-meta mt-0.5">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <Link to="/app/connect">
        <button className="bg-foreground text-background h-12 px-8 text-xs tracking-widest uppercase inline-flex items-center gap-3 hover:bg-foreground/85 transition-colors">
          Connect Repository →
        </button>
      </Link>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}
