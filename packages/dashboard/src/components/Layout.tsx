import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

const NAV_ITEMS = [
  { href: '/app', label: 'Dashboard' },
  { href: '/app/connect', label: 'Connect Repo' },
  { href: '/app/settings', label: 'Settings' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, mutate } = useAuth()

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    await mutate(null)
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top nav — thin, editorial */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-12">
          <div className="flex items-center gap-2">
            {/* Orange badge — product name */}
            <span className="bg-[#E85A1A] text-white text-xs tracking-widest uppercase px-2 py-0.5 font-normal">
              AgnusAI
            </span>
            <span className="label-meta hidden sm:block text-muted-foreground/60">
              Code Review
            </span>
          </div>

          <div className="flex items-center gap-0">
            <nav className="flex items-center gap-0">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href ||
                  (item.href !== '/app' && pathname.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={cn(
                      'label-meta px-4 h-12 flex items-center border-l border-border hover:text-foreground transition-colors',
                      isActive ? 'text-foreground border-b-2 border-b-foreground' : ''
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>

            {/* User + sign out */}
            {user && (
              <div className="flex items-center border-l border-border h-12">
                <span className="label-meta px-4 text-muted-foreground hidden md:block">
                  {user.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="label-meta px-4 h-12 flex items-center border-l border-border hover:text-foreground transition-colors"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-12">
        {children}
      </main>

      {/* Bottom ticker — TinyFish style */}
      <footer className="bg-foreground text-background border-t border-border overflow-hidden">
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
                <span key={item} className="flex items-center gap-6 px-8 py-3 label-meta text-background/70 border-r border-background/10">
                  <span className="text-[#E85A1A]">•</span>
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
