import useSWR from 'swr'
import { Link, useNavigate } from 'react-router-dom'
import { Trash2, RefreshCw, ExternalLink, GitPullRequest, Clock } from 'lucide-react'

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

const VERDICT_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  approve: {
    label: 'Approved',
    color: '#059669',
    dot: '#10B981',
  },
  request_changes: {
    label: 'Changes Requested',
    color: '#DC2626',
    dot: '#EF4444',
  },
  comment: {
    label: 'Commented',
    color: 'hsl(var(--muted-foreground))',
    dot: 'hsl(var(--muted-foreground))',
  },
}

export default function Dashboard() {
  const { data: repos, mutate: mutateRepos } = useSWR<Repo[]>('/api/repos', fetcher, { refreshInterval: 30000 })
  const { data: reviews } = useSWR<Review[]>('/api/reviews', fetcher, { refreshInterval: 30000 })
  const navigate = useNavigate()

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

  if (!hasData) {
    return <EmptyState />
  }

  const totalSymbols = repos.reduce((sum, r) => sum + (r.symbolCount ?? 0), 0)
  const totalReviews = reviews?.length ?? 0
  const approvedCount = reviews?.filter(r => r.verdict === 'approve').length ?? 0

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '32px' }}>
        <p className="label-meta" style={{ color: '#E85A1A', marginBottom: '6px' }}>// overview</p>
        <h1 style={{
          fontSize: '1.6rem',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'hsl(var(--foreground))',
          lineHeight: 1.1,
        }}>
          Dashboard
        </h1>
      </div>

      {/* KPI stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        border: '1px solid hsl(var(--border))',
        marginBottom: '32px',
      }}>
        {[
          { label: 'Repositories', value: repos.length, desc: 'connected' },
          { label: 'Total Reviews', value: totalReviews, desc: 'PRs reviewed' },
          { label: 'Symbols Indexed', value: totalSymbols.toLocaleString(), desc: 'across all repos' },
        ].map((stat, i) => (
          <div
            key={stat.label}
            style={{
              padding: '20px 24px',
              borderRight: i < 2 ? '1px solid hsl(var(--border))' : undefined,
            }}
          >
            <p className="label-meta" style={{ marginBottom: '8px' }}>{stat.label}</p>
            <div style={{
              fontSize: '2rem',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: 'hsl(var(--foreground))',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              marginBottom: '4px',
            }}>
              {stat.value}
            </div>
            <p className="label-meta" style={{ opacity: 0.5 }}>{stat.desc}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', border: '1px solid hsl(var(--border))' }}>
        {/* Repositories */}
        <div style={{ borderRight: '1px solid hsl(var(--border))', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <p className="label-meta">Repositories</p>
            <Link
              to="/app/connect"
              className="label-meta"
              style={{
                color: '#E85A1A',
                textDecoration: 'none',
              }}
            >
              + add repo
            </Link>
          </div>

          {/* Repo list */}
          <div>
            {repos.map((repo) => {
              const repoName = repo.repoUrl
                .replace('https://github.com/', '')
                .replace('https://dev.azure.com/', '')
              return (
                <div
                  key={repo.repoId}
                  style={{
                    padding: '12px 20px',
                    borderBottom: '1px solid hsl(var(--border))',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onClick={() => navigate(`/app/repos/${repo.repoId}`)}
                  onMouseEnter={e => (e.currentTarget.style.background = 'hsl(var(--muted) / 0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Platform glyph */}
                  <div style={{
                    width: '28px',
                    height: '28px',
                    flexShrink: 0,
                    border: '1px solid hsl(var(--border))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    color: 'hsl(var(--muted-foreground))',
                    fontFamily: 'inherit',
                  }}>
                    {repo.platform === 'github' ? 'GH' : 'AZ'}
                  </div>

                  {/* Name + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      color: 'hsl(var(--foreground))',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {repoName}
                    </div>
                    <div className="label-meta" style={{ marginTop: '2px', display: 'flex', gap: '8px', opacity: 0.6 }}>
                      {repo.indexedAt ? (
                        <span style={{ color: '#059669' }}>✓ {repo.symbolCount.toLocaleString()} symbols</span>
                      ) : (
                        <span style={{ color: '#F59E0B' }}>not indexed</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <Link
                      to={`/app/repos/${repo.repoId}`}
                      title="Analytics"
                      style={{
                        width: '26px', height: '26px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'hsl(var(--muted-foreground))',
                        textDecoration: 'none',
                        transition: 'color 0.1s',
                      }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'hsl(var(--foreground))')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      onClick={() => handleReindex(repo.repoId)}
                      title="Reindex"
                      style={{
                        width: '26px', height: '26px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'hsl(var(--muted-foreground))',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'color 0.1s',
                      }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'hsl(var(--foreground))')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(repo.repoId, repo.repoUrl)}
                      title="Delete"
                      style={{
                        width: '26px', height: '26px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'hsl(var(--muted-foreground))',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'color 0.1s',
                      }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#EF4444')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent Reviews */}
        <div style={{ overflow: 'hidden' }}>
          {/* Header */}
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <p className="label-meta">Recent Reviews</p>
            {totalReviews > 0 && (
              <span className="label-meta" style={{ opacity: 0.5 }}>{totalReviews} total</span>
            )}
          </div>

          {/* Reviews list */}
          {reviews && reviews.length > 0 ? (
            <div>
              {reviews.slice(0, 8).map((r) => {
                const cfg = VERDICT_CONFIG[r.verdict] ?? VERDICT_CONFIG.comment
                const repoName = r.repoUrl.split('/').slice(-2).join('/')
                return (
                  <div
                    key={r.id}
                    style={{
                      padding: '12px 20px',
                      borderBottom: '1px solid hsl(var(--border))',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    {/* Verdict dot */}
                    <div style={{
                      width: '6px', height: '6px',
                      borderRadius: '50%',
                      background: cfg.dot,
                      flexShrink: 0,
                    }} />

                    {/* PR info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        color: 'hsl(var(--foreground))',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {repoName}{' '}
                        <span style={{ fontWeight: 400, color: 'hsl(var(--muted-foreground))' }}>#{r.prNumber}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                        <span
                          className="label-meta"
                          style={{
                            color: cfg.color,
                            border: `1px solid ${cfg.dot}`,
                            padding: '1px 6px',
                          }}
                        >
                          {cfg.label}
                        </span>
                        <span className="label-meta" style={{ opacity: 0.5 }}>
                          {r.commentCount} comment{r.commentCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Date */}
                    <div className="label-meta" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, opacity: 0.5 }}>
                      <Clock className="h-3 w-3" />
                      {formatDate(r.createdAt)}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <GitPullRequest style={{ width: '28px', height: '28px', color: 'hsl(var(--muted-foreground))', opacity: 0.3, margin: '0 auto 12px' }} />
              <p className="label-meta" style={{ marginBottom: '4px' }}>No reviews yet</p>
              <p className="label-meta" style={{ opacity: 0.5 }}>Open a pull request to trigger your first review</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '32px' }}>
        <p className="label-meta" style={{ color: '#E85A1A', marginBottom: '6px' }}>// get started</p>
        <h1 style={{
          fontSize: '1.6rem',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'hsl(var(--foreground))',
          lineHeight: 1.1,
        }}>
          Welcome to Ryv
        </h1>
      </div>

      {/* Empty state card */}
      <div style={{
        border: '1px solid hsl(var(--border))',
        overflow: 'hidden',
        maxWidth: '600px',
      }}>
        {/* Top accent line */}
        <div style={{ height: '2px', background: '#E85A1A' }} />

        <div style={{ padding: '32px' }}>
          {/* Steps */}
          <div style={{ marginBottom: '32px' }}>
            {[
              {
                n: '01',
                title: 'Connect a Repository',
                desc: 'Add your GitHub or Azure DevOps repo URL and a personal access token',
              },
              {
                n: '02',
                title: 'Index Your Codebase',
                desc: 'Ryv uses Tree-sitter to build a live symbol dependency graph',
              },
              {
                n: '03',
                title: 'Get Smarter Reviews',
                desc: 'Every PR receives blast-radius-aware, context-rich comments automatically',
              },
            ].map((step, i) => (
              <div
                key={step.n}
                style={{
                  display: 'flex',
                  gap: '16px',
                  paddingBottom: i < 2 ? '24px' : '0',
                  position: 'relative',
                }}
              >
                {/* Connector line */}
                {i < 2 && (
                  <div style={{
                    position: 'absolute',
                    left: '13px',
                    top: '28px',
                    bottom: '0',
                    width: '1px',
                    background: 'hsl(var(--border))',
                  }} />
                )}
                {/* Step number */}
                <div style={{
                  width: '28px',
                  height: '28px',
                  flexShrink: 0,
                  border: '1px solid #E85A1A',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  zIndex: 1,
                  background: 'hsl(var(--background))',
                }}>
                  <span className="label-meta" style={{ color: '#E85A1A' }}>{step.n}</span>
                </div>
                <div style={{ paddingTop: '4px' }}>
                  <div style={{
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    color: 'hsl(var(--foreground))',
                    marginBottom: '4px',
                    letterSpacing: '-0.01em',
                  }}>
                    {step.title}
                  </div>
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'hsl(var(--muted-foreground))',
                    lineHeight: 1.5,
                  }}>
                    {step.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Link
            to="/app/connect"
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              background: '#E85A1A',
              padding: '10px 20px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
          >
            Connect Your First Repository
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
}
