import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { APP_SHORT } from '@/config/app'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  matchExact?: boolean
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/app',
    label: 'Dashboard',
    matchExact: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: '/app/connect',
    label: 'Add Repository',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
  },
  {
    href: '/app/rules',
    label: 'Review Rules',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    href: '/app/settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, mutate } = useAuth()
  const { isDark, toggle } = useTheme()

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    await mutate(null)
    navigate('/login')
  }

  async function handleSwitchOrg(orgId: string) {
    await fetch('/api/auth/switch-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ orgId }),
    })
    await mutate()
  }

  const activeOrg = user?.orgs?.find(o => o.orgId === user.activeOrgId)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'hsl(var(--background))' }}>
      {/* ── Top bar ── */}
      <header
        style={{
          background: 'hsl(var(--card))',
          borderBottom: '1px solid hsl(var(--border))',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            maxWidth: '1600px',
            margin: '0 auto',
            padding: '0 24px',
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          {/* Brand */}
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <div style={{
              width: '28px', height: '28px',
              background: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)',
              borderRadius: '7px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '0.88rem', color: '#fff' }}>R</span>
            </div>
            <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '1rem', color: 'hsl(var(--foreground))', letterSpacing: '-0.02em' }}>
              {APP_SHORT}
            </span>
          </Link>

          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
            {/* Org switcher */}
            {user?.orgs && user.orgs.length > 1 && (
              <div style={{ width: '190px' }}>
                <Select value={user.activeOrgId ?? ''} onValueChange={handleSwitchOrg}>
                  <SelectTrigger
                    style={{
                      background: 'hsl(var(--muted))',
                      border: '1px solid hsl(var(--border))',
                      color: 'hsl(var(--foreground))',
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: '0.8rem',
                      height: '32px',
                      minHeight: '32px',
                      borderRadius: '6px',
                    }}
                  >
                    <SelectValue placeholder="Select org" />
                  </SelectTrigger>
                  <SelectContent>
                    {user.orgs.map(org => (
                      <SelectItem key={org.orgId} value={org.orgId}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {user && (
              <span style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.78rem',
                color: 'hsl(var(--muted-foreground))',
                whiteSpace: 'nowrap',
                padding: '0 8px',
              }}>
                {user.email}
              </span>
            )}

            <button
              onClick={toggle}
              aria-label="Toggle theme"
              style={{
                background: 'hsl(var(--muted))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '7px',
                color: 'hsl(var(--muted-foreground))',
                cursor: 'pointer',
                fontSize: '0.85rem',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s',
                flexShrink: 0,
              }}
            >
              {isDark ? '○' : '☽'}
            </button>

            {user && (
              <button
                onClick={handleSignOut}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  color: 'hsl(var(--muted-foreground))',
                  background: 'transparent',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  padding: '0 12px',
                  height: '30px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'color 0.15s, background 0.15s',
                  flexShrink: 0,
                }}
              >
                Sign Out
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Body: sidebar + content ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ── Sidebar ── */}
        <aside
          style={{
            width: '240px',
            flexShrink: 0,
            background: 'hsl(var(--card))',
            borderRight: '1px solid hsl(var(--border))',
            display: 'flex',
            flexDirection: 'column',
            position: 'sticky',
            top: '56px',
            height: 'calc(100vh - 56px)',
            overflowY: 'auto',
          }}
        >
          {/* Org info */}
          {(activeOrg || user) && (
            <div style={{
              padding: '20px 16px 16px',
              borderBottom: '1px solid hsl(var(--border))',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <div style={{
                  width: '32px', height: '32px',
                  background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)',
                  borderRadius: '8px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Outfit, sans-serif',
                  fontWeight: 800, fontSize: '0.75rem', color: '#fff',
                  flexShrink: 0,
                }}>
                  {(activeOrg?.name ?? user?.email ?? 'U').charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'DM Sans, sans-serif',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    color: 'hsl(var(--foreground))',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {activeOrg?.name ?? 'My Workspace'}
                  </div>
                  <div style={{
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: '0.72rem',
                    color: 'hsl(var(--muted-foreground))',
                  }}>
                    {user?.activeOrgRole ?? 'member'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Nav items */}
          <nav style={{ padding: '12px 8px', flex: 1 }}>
            <div style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'hsl(var(--muted-foreground))',
              padding: '4px 8px 8px',
            }}>
              Navigation
            </div>
            {NAV_ITEMS.map((item) => {
              const isActive = item.matchExact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + '/')

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '9px 10px',
                    borderRadius: '8px',
                    marginBottom: '2px',
                    textDecoration: 'none',
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: '0.875rem',
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                    background: isActive ? 'hsl(var(--primary) / 0.08)' : 'transparent',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = 'hsl(var(--muted))'
                      ;(e.currentTarget as HTMLElement).style.color = 'hsl(var(--foreground))'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = 'transparent'
                      ;(e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))'
                    }
                  }}
                >
                  <span style={{
                    opacity: isActive ? 1 : 0.65,
                    flexShrink: 0,
                    color: isActive ? 'hsl(var(--primary))' : 'inherit',
                  }}>
                    {item.icon}
                  </span>
                  {item.label}
                  {isActive && (
                    <span style={{
                      marginLeft: 'auto',
                      width: '6px', height: '6px',
                      background: 'hsl(var(--primary))',
                      borderRadius: '50%',
                      flexShrink: 0,
                    }} />
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Bottom: user info + docs link */}
          <div style={{
            padding: '12px 8px',
            borderTop: '1px solid hsl(var(--border))',
          }}>
            <a
              href="/docs/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 10px',
                borderRadius: '8px',
                textDecoration: 'none',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'hsl(var(--muted-foreground))',
                transition: 'background 0.15s, color 0.15s',
                marginBottom: '4px',
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.65 }}>
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              Documentation
            </a>

            {user && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                marginTop: '4px',
              }}>
                <div style={{
                  width: '26px', height: '26px',
                  background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '0.62rem', fontWeight: 700, color: '#fff',
                  flexShrink: 0,
                }}>
                  {user.email.charAt(0).toUpperCase()}
                </div>
                <span style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: '0.75rem',
                  color: 'hsl(var(--muted-foreground))',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}>
                  {user.email}
                </span>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            padding: '32px 40px',
            overflowY: 'auto',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
