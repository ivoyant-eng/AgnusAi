import { Link } from 'react-router-dom'
import { useTheme } from '@/hooks/useTheme'
import { APP_NAME } from '@/config/app'

export function LandingHeader() {
  const { isDark, toggle } = useTheme()
  const brandLabel = `~/${APP_NAME.toLowerCase()}`

  return (
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
        {/* Brand — Link to="/" is React Router (internal) */}
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
          <span style={{ fontWeight: 700 }}>{brandLabel}</span>
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
        <nav style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <a href="/docs/" className="nav-pill">
            <span className="cmd">$</span> man docs
          </a>
          <a
            href="https://github.com/ivoyant-eng/AgnusAi"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-pill"
          >
            <span className="cmd">$</span> git --repo
          </a>
          <Link to="/app" className="nav-pill nav-pill-cta">
            $ open --app
          </Link>
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
  )
}
