import useSWR from 'swr'
import { Link, useNavigate } from 'react-router-dom'
import { Trash2, RefreshCw, ExternalLink, GitPullRequest, Database, CheckCircle2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

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

const VERDICT_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  approve: {
    label: 'Approved',
    bg: 'rgba(16,185,129,0.08)',
    color: '#059669',
    dot: '#10B981',
  },
  request_changes: {
    label: 'Changes Requested',
    bg: 'rgba(239,68,68,0.08)',
    color: '#DC2626',
    dot: '#EF4444',
  },
  comment: {
    label: 'Commented',
    bg: 'rgba(100,116,139,0.08)',
    color: 'hsl(var(--muted-foreground))',
    dot: '#94A3B8',
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
        <h1 style={{
          fontFamily: 'Outfit, sans-serif',
          fontSize: '1.75rem',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'hsl(var(--foreground))',
          marginBottom: '6px',
        }}>
          Dashboard
        </h1>
        <p style={{
          fontFamily: 'DM Sans, sans-serif',
          fontSize: '0.9rem',
          color: 'hsl(var(--muted-foreground))',
        }}>
          Monitor your repositories and review activity
        </p>
      </div>

      {/* KPI cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
        marginBottom: '32px',
      }}>
        {[
          {
            label: 'Repositories',
            value: repos.length,
            suffix: '',
            desc: 'Connected repos',
            icon: <Database className="h-4 w-4" />,
            color: '#2563EB',
          },
          {
            label: 'Total Reviews',
            value: totalReviews,
            suffix: '',
            desc: 'PRs reviewed',
            icon: <GitPullRequest className="h-4 w-4" />,
            color: '#7C3AED',
          },
          {
            label: 'Symbols Indexed',
            value: totalSymbols.toLocaleString(),
            suffix: '',
            desc: 'Across all repos',
            icon: <CheckCircle2 className="h-4 w-4" />,
            color: '#059669',
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '10px',
              padding: '20px 24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'hsl(var(--muted-foreground))',
              }}>
                {card.label}
              </span>
              <div style={{
                width: '32px', height: '32px',
                background: card.color + '14',
                borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: card.color,
              }}>
                {card.icon}
              </div>
            </div>
            <div style={{
              fontFamily: 'Outfit, sans-serif',
              fontSize: '1.75rem',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: 'hsl(var(--foreground))',
              lineHeight: 1,
              marginBottom: '4px',
            }}>
              {card.value}
            </div>
            <div style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '0.75rem',
              color: 'hsl(var(--muted-foreground))',
            }}>
              {card.desc}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Repositories */}
        <div style={{
          background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '10px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h2 style={{
              fontFamily: 'Outfit, sans-serif',
              fontSize: '0.95rem',
              fontWeight: 700,
              color: 'hsl(var(--foreground))',
            }}>
              Repositories
            </h2>
            <Link
              to="/app/connect"
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: 'hsl(var(--primary))',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              + Add Repo
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
                    padding: '14px 20px',
                    borderBottom: '1px solid hsl(var(--border))',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onClick={() => navigate(`/app/repos/${repo.repoId}`)}
                  onMouseEnter={e => (e.currentTarget.style.background = 'hsl(var(--muted))')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Platform icon */}
                  <div style={{
                    width: '32px', height: '32px', flexShrink: 0,
                    background: 'hsl(var(--muted))',
                    borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.85rem',
                  }}>
                    {repo.platform === 'github' ? '⌥' : '☁'}
                  </div>

                  {/* Name + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: 'hsl(var(--foreground))',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {repoName}
                    </div>
                    <div style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: '0.72rem',
                      color: 'hsl(var(--muted-foreground))',
                      marginTop: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}>
                      <span style={{ textTransform: 'capitalize' }}>{repo.platform}</span>
                      {repo.indexedAt && (
                        <>
                          <span>·</span>
                          <span style={{ color: '#059669' }}>✓ {repo.symbolCount.toLocaleString()} symbols</span>
                        </>
                      )}
                      {!repo.indexedAt && (
                        <>
                          <span>·</span>
                          <span style={{ color: '#F59E0B' }}>Not indexed</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <Link
                      to={`/app/repos/${repo.repoId}`}
                      title="Analytics"
                      style={{
                        width: '28px', height: '28px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: '6px',
                        color: 'hsl(var(--muted-foreground))',
                        transition: 'background 0.15s, color 0.15s',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'hsl(var(--muted))'
                        ;(e.currentTarget as HTMLElement).style.color = 'hsl(var(--foreground))'
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = 'transparent'
                        ;(e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))'
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      onClick={() => handleReindex(repo.repoId)}
                      title="Reindex"
                      style={{
                        width: '28px', height: '28px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: '6px',
                        color: 'hsl(var(--muted-foreground))',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'hsl(var(--muted))'
                        ;(e.currentTarget as HTMLElement).style.color = 'hsl(var(--foreground))'
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = 'transparent'
                        ;(e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))'
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(repo.repoId, repo.repoUrl)}
                      title="Delete"
                      style={{
                        width: '28px', height: '28px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: '6px',
                        color: 'hsl(var(--muted-foreground))',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.08)'
                        ;(e.currentTarget as HTMLElement).style.color = '#EF4444'
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = 'transparent'
                        ;(e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))'
                      }}
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
        <div style={{
          background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '10px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h2 style={{
              fontFamily: 'Outfit, sans-serif',
              fontSize: '0.95rem',
              fontWeight: 700,
              color: 'hsl(var(--foreground))',
            }}>
              Recent Reviews
            </h2>
            {totalReviews > 0 && (
              <span style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.72rem',
                color: 'hsl(var(--muted-foreground))',
              }}>
                {totalReviews} total
              </span>
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
                      padding: '14px 20px',
                      borderBottom: '1px solid hsl(var(--border))',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    {/* Verdict dot */}
                    <div style={{
                      width: '8px', height: '8px',
                      borderRadius: '50%',
                      background: cfg.dot,
                      flexShrink: 0,
                    }} />

                    {/* PR info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'DM Sans, sans-serif',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: 'hsl(var(--foreground))',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {repoName} <span style={{ fontWeight: 400, color: 'hsl(var(--muted-foreground))' }}>#{r.prNumber}</span>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '2px',
                      }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontFamily: 'DM Sans, sans-serif',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          color: cfg.color,
                          background: cfg.bg,
                          padding: '2px 7px',
                          borderRadius: '4px',
                        }}>
                          {cfg.label}
                        </span>
                        <span style={{
                          fontFamily: 'DM Sans, sans-serif',
                          fontSize: '0.72rem',
                          color: 'hsl(var(--muted-foreground))',
                        }}>
                          {r.commentCount} comment{r.commentCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Date */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: '0.72rem',
                      color: 'hsl(var(--muted-foreground))',
                      flexShrink: 0,
                    }}>
                      <Clock className="h-3 w-3" />
                      {formatDate(r.createdAt)}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{
              padding: '48px 24px',
              textAlign: 'center',
            }}>
              <GitPullRequest style={{ width: '32px', height: '32px', color: 'hsl(var(--muted-foreground))', opacity: 0.4, margin: '0 auto 12px' }} />
              <p style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.875rem',
                color: 'hsl(var(--muted-foreground))',
                marginBottom: '4px',
              }}>
                No reviews yet
              </p>
              <p style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.78rem',
                color: 'hsl(var(--muted-foreground))',
                opacity: 0.7,
              }}>
                Open a pull request to trigger your first review
              </p>
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
        <h1 style={{
          fontFamily: 'Outfit, sans-serif',
          fontSize: '1.75rem',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'hsl(var(--foreground))',
          marginBottom: '6px',
        }}>
          Welcome to Ryv
        </h1>
        <p style={{
          fontFamily: 'DM Sans, sans-serif',
          fontSize: '0.9rem',
          color: 'hsl(var(--muted-foreground))',
        }}>
          Connect your first repository to start getting graph-aware PR reviews
        </p>
      </div>

      {/* Empty state card */}
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        maxWidth: '680px',
      }}>
        {/* Top gradient accent */}
        <div style={{
          height: '3px',
          background: 'linear-gradient(90deg, #2563EB 0%, #06B6D4 100%)',
        }} />

        <div style={{ padding: '32px' }}>
          {/* Steps */}
          <div style={{ marginBottom: '32px' }}>
            {[
              {
                n: '01',
                icon: '🔗',
                title: 'Connect a Repository',
                desc: 'Add your GitHub or Azure DevOps repo URL and a personal access token',
              },
              {
                n: '02',
                icon: '🕸️',
                title: 'Index Your Codebase',
                desc: 'Ryv uses Tree-sitter to build a live symbol dependency graph',
              },
              {
                n: '03',
                icon: '⚡',
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
                    left: '19px',
                    top: '40px',
                    bottom: '0',
                    width: '1px',
                    background: 'hsl(var(--border))',
                  }} />
                )}
                {/* Step icon */}
                <div style={{
                  width: '40px', height: '40px', flexShrink: 0,
                  background: 'hsl(var(--primary) / 0.08)',
                  borderRadius: '10px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.1rem',
                  position: 'relative',
                  zIndex: 1,
                }}>
                  {step.icon}
                </div>
                <div>
                  <div style={{
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    color: 'hsl(var(--foreground))',
                    marginBottom: '4px',
                  }}>
                    {step.title}
                  </div>
                  <div style={{
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: '0.84rem',
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
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '0.9rem',
              fontWeight: 600,
              color: '#FFFFFF',
              background: 'hsl(var(--primary))',
              padding: '11px 24px',
              borderRadius: '8px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'opacity 0.15s',
            }}
          >
            Connect Your First Repository
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
