import { Link } from 'react-router-dom'
import { useTheme } from '@/hooks/useTheme'
import { APP_SHORT } from '@/config/app'

export function LandingHeader() {
  const { isDark, toggle } = useTheme()

  const bg = isDark ? '#080D1C' : '#FFFFFF'
  const border = isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0'
  const textColor = isDark ? 'rgba(248,250,252,0.75)' : '#4B5563'
  const textHover = isDark ? '#F8FAFC' : '#0F172A'
  const textHoverBg = isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9'
  const logoText = isDark ? '#F8FAFC' : '#0F172A'
  const dividerColor = isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0'
  const toggleBg = isDark ? 'rgba(255,255,255,0.07)' : '#F1F5F9'
  const toggleBorder = isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0'
  const toggleColor = isDark ? 'rgba(248,250,252,0.6)' : '#6B7280'

  return (
    <header
      style={{
        background: bg,
        borderBottom: `1px solid ${border}`,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        transition: 'background 0.2s, border-color 0.2s',
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0 32px',
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Brand */}
        <Link
          to="/"
          style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}
        >
          <div
            style={{
              width: '30px', height: '30px',
              background: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)',
              borderRadius: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '0.9rem', color: '#fff' }}>R</span>
          </div>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '1.1rem', color: logoText, letterSpacing: '-0.02em', transition: 'color 0.2s' }}>
            {APP_SHORT}
          </span>
        </Link>

        {/* Nav */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {[
            { label: 'Docs', href: '/docs/', external: false },
            { label: 'GitHub', href: 'https://github.com/ivoyant-eng/AgnusAi', external: true },
            { label: 'Pricing', href: '/docs/pricing', external: false },
          ].map(({ label, href, external }) => (
            <a
              key={label}
              href={href}
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: textColor,
                textDecoration: 'none',
                padding: '6px 14px',
                borderRadius: '6px',
                transition: 'color 0.15s, background 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.color = textHover
                ;(e.currentTarget as HTMLElement).style.background = textHoverBg
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.color = textColor
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              {label}
            </a>
          ))}

          <div style={{ width: '1px', height: '20px', background: dividerColor, margin: '0 6px' }} />

          <Link
            to="/login"
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: textColor,
              textDecoration: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = textHover
              ;(e.currentTarget as HTMLElement).style.background = textHoverBg
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = textColor
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            Log in
          </Link>

          <Link
            to="/app"
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#FFFFFF',
              background: '#2563EB',
              border: 'none',
              padding: '8px 20px',
              borderRadius: '8px',
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginLeft: '4px',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#1D4ED8'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#2563EB'}
          >
            Get Started
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>

          <button
            onClick={toggle}
            aria-label="Toggle theme"
            style={{
              background: toggleBg,
              border: `1px solid ${toggleBorder}`,
              borderRadius: '8px',
              color: toggleColor,
              cursor: 'pointer',
              fontSize: '0.85rem',
              width: '34px', height: '34px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginLeft: '6px',
              transition: 'background 0.15s, border-color 0.15s',
              flexShrink: 0,
            }}
          >
            {isDark ? '○' : '☽'}
          </button>
        </nav>
      </div>
    </header>
  )
}
