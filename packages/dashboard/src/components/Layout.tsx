import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { APP_SHORT } from '@/config/app'

const NAV_ITEMS = [
  { href: '/app', label: 'dashboard' },
  { href: '/app/connect', label: 'connect' },
  { href: '/app/rules', label: 'rules' },
  { href: '/app/settings', label: 'settings' },
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top nav — dark terminal header matching landing page */}
      <header
        style={{
          background: 'var(--lp-hdr-bg)',
          borderBottom: '1px solid var(--lp-hdr-border)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '0 24px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Brand — terminal style matching LandingHeader */}
          <Link
            to="/"
            className="lp-mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '0.82rem',
              color: 'var(--lp-hdr-fg)',
              textDecoration: 'none',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: 'var(--syn-str)',
              }}
            />
            <span style={{ fontWeight: 700 }}>~/{APP_SHORT.toLowerCase()}</span>
            <span
              className="animate-blink"
              style={{
                display: 'inline-block',
                width: '2px',
                height: '14px',
                background: 'var(--lp-accent)',
              }}
            />
          </Link>

          <nav style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/app' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className="nav-pill"
                  style={
                    isActive
                      ? { opacity: 1, borderColor: 'var(--lp-accent)', color: 'var(--lp-accent)' }
                      : undefined
                  }
                >
                  <span className="cmd">$</span> {item.label}
                </Link>
              )
            })}

            {user && (
              <>
                {user.orgs && user.orgs.length > 1 && (
                  <div style={{ width: '190px' }}>
                    <Select value={user.activeOrgId ?? ''} onValueChange={handleSwitchOrg}>
                      <SelectTrigger
                        className="lp-mono"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--lp-hdr-border)',
                          color: 'var(--lp-hdr-fg)',
                          fontSize: '0.62rem',
                          height: '28px',
                          minHeight: '28px',
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
                <span
                  className="lp-mono"
                  style={{
                    fontSize: '0.62rem',
                    color: 'var(--lp-hdr-fg)',
                    opacity: 0.4,
                    padding: '0 8px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="nav-pill"
                  style={{ background: 'transparent', cursor: 'pointer' }}
                >
                  <span className="cmd">$</span> exit
                </button>
              </>
            )}

            <button
              onClick={toggle}
              aria-label="Toggle theme"
              style={{
                background: 'transparent',
                border: '1px solid var(--lp-hdr-border)',
                borderRadius: '999px',
                color: 'var(--lp-hdr-fg)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                width: '32px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.65,
              }}
            >
              {isDark ? '○' : '☽'}
            </button>
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-12">
        {children}
      </main>

      {/* Bottom ticker — TinyFish style */}
      <footer
        style={{
          background: 'var(--lp-hdr-bg)',
          borderTop: '1px solid var(--lp-hdr-border)',
          overflow: 'hidden',
        }}
      >
        <div className="flex animate-ticker" style={{ width: 'max-content' }}>
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex items-center gap-0 shrink-0">
              {[
                'Graph-Aware Review',
                'Tree-Sitter Parsing',
                'Postgres + pgvector',
                'Blast Radius Analysis',
                'Webhook Triggered',
                '100% Self-Hosted',
                'Open Source',
              ].map((item) => (
                <span
                  key={item}
                  className="lp-mono"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '10px 24px',
                    fontSize: '0.58rem',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'color-mix(in srgb, var(--lp-hdr-fg) 40%, transparent)',
                    borderRight: '1px solid color-mix(in srgb, var(--lp-hdr-fg) 8%, transparent)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: 'var(--lp-accent)', fontSize: '0.4rem' }}>◆</span>
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
      </footer>
    </div>
  )
}
