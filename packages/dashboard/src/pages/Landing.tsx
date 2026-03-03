import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LandingHeader } from '@/components/LandingHeader'
import { GraphViz } from '@/components/GraphViz'
import { APP_NAME, APP_SHORT, APP_TITLE, APP_GITHUB_URL } from '@/config/app'

const TICKER_ITEMS = [
  'Graph-Aware Reviews', 'Tree-Sitter Parsing', 'Postgres + pgvector',
  'Blast Radius Analysis', 'Webhook Triggered', '100% Self-Hosted',
  'MIT Licensed', 'Incremental Indexing', 'TypeScript · Python · Java · Go · C#',
  'Ollama · OpenAI · Claude · Azure', 'Precision Filter', 'RAG Feedback Loop',
  'Azure DevOps + GitHub', 'Multi-Agent Review', 'Rules System Analytics',
  'Ticket Compliance', 'PR Description Generation', 'Zero Data Egress',
]

export default function Landing() {
  useEffect(() => {
    document.title = APP_TITLE
    return () => { document.title = APP_SHORT }
  }, [])

  return (
    <div className="lp-root">
      <LandingHeader />
      <HeroSection />
      <MetricsBar />
      <MultiAgentSection />
      <ComparisonSection />
      <FeaturesSection />
      <GovernanceSection />
      <TicketSection />
      <HowItWorksSection />
      <SecuritySection />
      <TestimonialsSection />
      <FAQSection />
      <CtaSection />
      <LandingFooter />
    </div>
  )
}

/* ─── Hero ─────────────────────────────────────────────────────────────────── */
function HeroSection() {
  return (
    <section
      style={{
        background: 'var(--hero-section-bg)',
        borderBottom: '1px solid var(--lp-border)',
        padding: '88px 0 96px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute', top: '-150px', left: '-100px',
        width: '700px', height: '700px',
        background: 'radial-gradient(circle, rgba(37,99,235,0.14) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-80px', right: '-80px',
        width: '500px', height: '500px',
        background: 'radial-gradient(circle, rgba(6,182,212,0.1) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />

      <div
        className="hero-inner-grid"
        style={{
          maxWidth: '1280px', margin: '0 auto', padding: '0 32px',
          display: 'grid', gridTemplateColumns: '1.1fr 1fr',
          gap: '64px', alignItems: 'center', position: 'relative', zIndex: 1,
        }}
      >
        {/* Left: copy */}
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.25)',
            color: 'var(--lp-accent)', fontFamily: 'DM Sans, sans-serif',
            fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em',
            padding: '6px 14px', borderRadius: '999px', marginBottom: '28px',
          }}>
            <span style={{
              width: '6px', height: '6px', background: 'var(--lp-accent)',
              borderRadius: '50%', animation: 'pulse-dot 2s ease-in-out infinite',
            }} />
            Now shipping: Multi-agent review + Ticket compliance
          </div>

          <h1 style={{
            fontFamily: 'Outfit, sans-serif',
            fontSize: 'clamp(2.4rem, 4vw, 3.6rem)',
            fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05,
            color: 'var(--lp-fg)', marginBottom: '24px',
          }}>
            AI code review that<br />
            <span style={{
              background: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              sees the whole picture.
            </span>
          </h1>

          <p style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: '1.05rem',
            color: 'var(--lp-muted)', lineHeight: 1.75,
            marginBottom: '36px', maxWidth: '480px',
          }}>
            Ryv builds a live symbol dependency graph of your codebase and fans out to
            6 specialist AI agents — catching security issues, breaking changes, and
            compliance gaps before every merge.
          </p>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Link
              to="/app"
              style={{
                fontFamily: 'DM Sans, sans-serif', fontSize: '0.95rem', fontWeight: 600,
                color: '#FFFFFF', background: '#2563EB', border: 'none',
                padding: '13px 28px', borderRadius: '8px', cursor: 'pointer',
                transition: 'background 0.15s', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
              }}
            >
              Start for Free
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <a
              href="/docs/"
              style={{
                fontFamily: 'DM Sans, sans-serif', fontSize: '0.95rem', fontWeight: 600,
                color: 'var(--lp-fg)', background: 'transparent',
                border: '1px solid var(--lp-border)', padding: '13px 28px',
                borderRadius: '8px', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s',
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px',
              }}
            >
              View Docs
            </a>
          </div>

          {/* Social proof */}
          <div style={{ marginTop: '40px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {['SR', 'MA', 'TK', '+'].map((init, i) => (
                <div key={i} style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: i < 3 ? 'linear-gradient(135deg, #2563EB, #06B6D4)' : 'var(--lp-border)',
                  border: '2px solid var(--hero-section-bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Outfit, sans-serif', fontSize: '0.6rem', fontWeight: 700, color: 'white',
                  marginLeft: i > 0 ? '-8px' : '0', position: 'relative', zIndex: 4 - i,
                }}>
                  {init}
                </div>
              ))}
            </div>
            <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '0.8rem', color: 'var(--lp-muted)' }}>
              Trusted by engineering teams in fintech, healthtech &amp; SaaS
            </p>
          </div>
        </div>

        {/* Right: GraphViz + review result */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <GraphViz />
          <div className="hero-panel">
            <div className="hero-panel-bar">
              <div className="tl-dots">
                <span className="tl tl-r" /><span className="tl tl-y" /><span className="tl tl-g" />
              </div>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem', color: 'rgba(248,250,252,0.35)', marginLeft: '4px' }}>
                review-result.json
              </span>
              <span style={{
                marginLeft: 'auto', fontFamily: 'DM Sans, sans-serif', fontSize: '0.6rem',
                fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: '#F87171', background: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.2)', padding: '2px 8px', borderRadius: '4px',
              }}>
                request_changes
              </span>
            </div>
            <div style={{
              padding: '16px 18px', fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.7rem', lineHeight: 1.85, color: 'rgba(248,250,252,0.75)',
            }}>
              <span style={{ color: '#64748B' }}>{'// PR #247 — payments/charge.ts'}</span><br />
              <span style={{ color: '#60A5FA' }}>const</span>{' '}result = {'{'}<br />
              &nbsp;&nbsp;blastRadius: <span style={{ color: '#93C5FD' }}>4</span>,{' '}<span style={{ color: '#64748B' }}>// callers affected</span><br />
              &nbsp;&nbsp;agents: <span style={{ color: '#34D399' }}>"security · correctness · blast"</span>,<br />
              &nbsp;&nbsp;comments: <span style={{ color: '#93C5FD' }}>3</span>,{' '}<span style={{ color: '#64748B' }}>// confidence ≥ 0.91</span><br />
              &nbsp;&nbsp;ticketCompliance: <span style={{ color: '#FBBF24' }}>"partial"</span>,<br />
              {'}'}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── Metrics Bar ───────────────────────────────────────────────────────────── */
function MetricsBar() {
  const metrics = [
    { num: '6', suffix: '', label: 'Specialist Agents' },
    { num: '6', suffix: '+', label: 'Languages Supported' },
    { num: '4', suffix: '', label: 'LLM Providers' },
    { num: '2', suffix: '-hop', label: 'Graph Depth (BFS)' },
    { num: 'MIT', suffix: '', label: 'License' },
    { num: '0', suffix: ' bytes', label: 'Data Egress (self-hosted)' },
  ]
  return (
    <div className="metrics-bar">
      <div className="metrics-inner">
        {metrics.map((m) => (
          <div key={m.label} className="metric-item">
            <div className="metric-num">{m.num}<em>{m.suffix}</em></div>
            <div className="metric-label">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Multi-Agent Section ───────────────────────────────────────────────────── */
function MultiAgentSection() {
  const agents = [
    {
      icon: '🔒', tag: 'Security',
      name: 'Security Agent',
      desc: 'XSS vectors, SQL injection, insecure deserialization, auth bypass, and secrets accidentally committed in diffs.',
    },
    {
      icon: '✅', tag: 'Correctness',
      name: 'Correctness Agent',
      desc: 'Logic errors, unreachable branches, null/undefined edge cases, off-by-one errors, and type safety gaps.',
    },
    {
      icon: '⚡', tag: 'Performance',
      name: 'Performance Agent',
      desc: 'Hotpath allocations, N+1 database queries, unnecessary re-renders, and cache invalidation anti-patterns.',
    },
    {
      icon: '🎨', tag: 'Style',
      name: 'Style & Maintainability',
      desc: "Naming conventions, DRY violations, excessive complexity, dead code, and patterns that violate your team's rules.",
    },
    {
      icon: '🎟️', tag: 'Compliance',
      name: 'Ticket Compliance',
      desc: 'Fetches acceptance criteria from Jira, Linear, Azure Boards, or GitHub Issues and checks if the diff delivers them.',
    },
    {
      icon: '🕸️', tag: 'Graph',
      name: 'Blast Radius Agent',
      desc: 'Reads the 2-hop BFS traversal output and flags callers and callees that are at risk from the changed symbols.',
    },
  ]

  return (
    <section style={{
      background: 'var(--lp-muted-bg)',
      borderTop: '1px solid var(--lp-border)',
      borderBottom: '1px solid var(--lp-border)',
      padding: '88px 0',
    }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 32px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <div className="lp-sec-label">Multi-Agent Architecture</div>
          <h2 className="lp-sec-h2">6 specialist agents. One Judge.</h2>
          <p style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: '1rem',
            color: 'var(--lp-muted)', lineHeight: 1.75,
            maxWidth: '580px', margin: '0 auto',
          }}>
            Unlike single-pass reviewers, Ryv fans out to 6 agents running in parallel — each
            focused on one concern. A deterministic + LLM Judge pass consolidates findings and
            eliminates false positives before any comment reaches your developers.
          </p>
        </div>

        {/* Agent cards */}
        <div className="agents-grid">
          {agents.map((a) => (
            <div key={a.name} className="agent-card">
              <div className="agent-icon">{a.icon}</div>
              <div className="agent-name">{a.name}</div>
              <div className="agent-desc">{a.desc}</div>
              <span className="agent-tag">{a.tag}</span>
            </div>
          ))}
        </div>

        {/* Judge card */}
        <div className="judge-card">
          <div className="judge-icon">⚖️</div>
          <div>
            <div style={{
              fontFamily: 'Outfit, sans-serif', fontSize: '1rem',
              fontWeight: 700, color: 'var(--lp-fg)', marginBottom: '6px',
            }}>
              Judge Agent — consolidation &amp; deduplication
            </div>
            <div style={{
              fontFamily: 'DM Sans, sans-serif', fontSize: '0.85rem',
              color: 'var(--lp-muted)', lineHeight: 1.65,
            }}>
              Runs deterministic fingerprint deduplication first, then an optional LLM pass
              to resolve conflicts and re-rank by impact. Configurable via{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', color: 'var(--lp-accent)' }}>
                JUDGE_ENABLED
              </span>,{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', color: 'var(--lp-accent)' }}>
                JUDGE_MODE
              </span>,{' '}and{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', color: 'var(--lp-accent)' }}>
                AGENT_CONCURRENCY
              </span>
              .
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── Comparison ────────────────────────────────────────────────────────────── */
function ComparisonSection() {
  return (
    <div style={{ background: 'var(--lp-bg)', borderTop: '1px solid var(--lp-border)' }}>
      <div className="lp-sec">
        <div className="lp-sec-label">The problem</div>
        <h2 className="lp-sec-h2">Flat diff reviews leave you exposed</h2>
        <p className="lp-sec-sub">
          Most AI code reviewers see only the changed lines. They miss what breaks downstream,
          flood PRs with low-confidence noise, and send your proprietary code to third-party APIs.
        </p>
        <div className="compare-wrap">
          <div className="compare-header">
            <div className="tl-dots">
              <span className="tl tl-r" /><span className="tl tl-y" /><span className="tl tl-g" />
            </div>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: 'var(--lp-muted)' }}>
              review-comparison.diff
            </span>
          </div>
          <div className="compare-body">
            <div className="compare-col">
              <div className="compare-col-hdr">Without Ryv</div>
              {[
                'Sees changed lines only — no caller context',
                'Re-reviews unchanged code on every push',
                'Misses breaking changes in downstream callers',
                'Single-pass review — all concerns lumped together',
                'Noisy, low-confidence speculative comments',
                'Fixed review style — never learns your team',
                'Code sent to third-party cloud API',
                'Ticket compliance checked manually by reviewers',
              ].map((t) => (
                <div key={t} className="compare-line compare-del">
                  <span className="compare-sign">–</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <div className="compare-col">
              <div className="compare-col-hdr">With Ryv</div>
              {[
                '2-hop BFS surfaces callers, callees, blast radius',
                'Incremental — only re-reviews new commits',
                'Flags affected downstream functions before merge',
                '6 specialist agents run in parallel, Judge consolidates',
                'Precision filter drops comments below confidence threshold',
                'RAG loop learns from your team\'s accepted comments',
                '100% self-hosted — zero data egress option',
                'Jira · Linear · Azure Boards · GitHub Issues adapter built-in',
              ].map((t) => (
                <div key={t} className="compare-line compare-add">
                  <span className="compare-sign">+</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Features ──────────────────────────────────────────────────────────────── */
function FeaturesSection() {
  const features = [
    {
      icon: '🔍', tag: '2-Hop BFS',
      title: 'Graph-Aware Blast Radius',
      desc: 'Tree-sitter builds a live dependency graph. Ryv traverses 2 hops to surface every caller and callee affected by a change — before the LLM writes a single comment.',
    },
    {
      icon: '🤖', tag: '6 Agents + Judge',
      title: 'Multi-Agent Specialist Review',
      desc: 'Security, correctness, performance, style, ticket compliance, and blast radius agents run concurrently. A Judge pass deduplicates and ranks findings by impact.',
    },
    {
      icon: '📋', tag: 'Rules · Analytics',
      title: 'Rules System & Governance',
      desc: 'Define standards in plain English. Rules are enforced on every PR, cited inline in comments, and tracked with per-rule adoption rates and violation trends.',
    },
    {
      icon: '🎟️', tag: 'Jira · Linear · Azure',
      title: 'Ticket Compliance',
      desc: 'Pulls acceptance criteria from Jira, Linear, Azure Boards, or GitHub Issues and checks each criterion against the diff — so nothing slips through unreviewed.',
    },
    {
      icon: '📝', tag: 'PR Automation',
      title: 'PR Description & Labels',
      desc: 'Automatically writes back the PR title, prose summary, file-by-file walkthrough, change type, and labels — reducing reviewer onboarding time on every PR.',
    },
    {
      icon: '🏠', tag: 'Self-Hosted',
      title: 'Your Code Never Leaves',
      desc: 'One docker compose up. Postgres, pgvector, and Ollama run on your infrastructure. No third-party API calls. Built for teams with strict data compliance requirements.',
    },
    {
      icon: '🧠', tag: 'RAG · Per-Repo',
      title: 'Learns From Your Team',
      desc: 'Every accepted review comment is embedded and stored. Future reviews inject your team\'s top-rated examples into the prompt. The more you use it, the better it gets.',
    },
    {
      icon: '🎯', tag: 'Signal / Noise',
      title: 'Precision Filter',
      desc: 'The LLM self-scores every comment with a confidence value. Anything below your threshold is silently dropped — only high-signal findings reach your developers.',
    },
    {
      icon: '⚡', tag: 'Incremental',
      title: 'Fast Incremental Reviews',
      desc: 'Checkpoints prevent re-reviewing unchanged commits. On GitHub and Azure DevOps, only new commits since the last review are processed — keeping costs minimal.',
    },
  ]

  return (
    <div style={{ background: 'var(--lp-muted-bg)', borderTop: '1px solid var(--lp-border)', borderBottom: '1px solid var(--lp-border)' }}>
      <div className="lp-sec">
        <div className="lp-sec-label">Features</div>
        <h2 className="lp-sec-h2">Everything you need to ship with confidence</h2>
        <p className="lp-sec-sub">
          Built for engineering teams who take code quality seriously — from solo startups
          to enterprise teams with the strictest security requirements.
        </p>
        <div className="features-grid">
          {features.map((f) => (
            <div key={f.title} className="feature-card">
              <div className="feature-icon-wrap">{f.icon}</div>
              <div className="feature-h3">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
              <span className="feature-tag">{f.tag}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Governance Section ─────────────────────────────────────────────────────── */
function GovernanceSection() {
  const rules = [
    { name: 'no-hardcoded-secrets', pct: 97, ok: true },
    { name: 'require-tests', pct: 78, ok: false },
    { name: 'no-any-typescript', pct: 71, ok: false },
  ]

  return (
    <div style={{
      background: 'var(--lp-bg)',
      borderTop: '1px solid var(--lp-border)',
      padding: '88px 0',
    }}>
      <div className="governance-inner-grid">
        {/* Left: copy */}
        <div>
          <div className="lp-sec-label">Rules System</div>
          <h2 className="lp-sec-h2">
            Write it once.<br />Enforce it on every PR.
          </h2>
          <p style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: '1rem',
            color: 'var(--lp-muted)', lineHeight: 1.75, marginBottom: '32px',
          }}>
            Define team standards in plain English. Ryv injects them directly into the
            review prompt — so every PR gets the same level of scrutiny, and violations
            are cited right inside the comment with the rule name.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '32px' }}>
            {[
              { icon: '📝', text: 'Plain-English rules — no regex, no DSL, no config files' },
              { icon: '🔌', text: 'Injected as "## Enforced Rules" directly into the LLM prompt' },
              { icon: '💬', text: 'Violations cited inline: [Rule: no-hardcoded-secrets] [Confidence: 0.97]' },
              { icon: '📊', text: 'Per-rule compliance tracking: adoption rate, trend, CSV export' },
            ].map((p) => (
              <div key={p.icon} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '1rem', marginTop: '2px' }}>{p.icon}</span>
                <span style={{
                  fontFamily: 'DM Sans, sans-serif', fontSize: '0.9rem',
                  color: 'var(--lp-fg)', lineHeight: 1.55,
                }}>
                  {p.text}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <a href="/docs/reference/rules" style={{
              fontFamily: 'DM Sans, sans-serif', fontSize: '0.85rem', fontWeight: 600,
              color: 'var(--lp-accent)', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}>
              Rules reference docs
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
            <a href="/docs/reference/rules#examples" style={{
              fontFamily: 'DM Sans, sans-serif', fontSize: '0.85rem', fontWeight: 500,
              color: 'var(--lp-muted)', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}>
              See example rules
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          </div>
        </div>

        {/* Right: PR comment mockup + analytics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* GitHub-style PR review comment */}
          <div style={{
            background: 'var(--lp-card-bg)',
            border: '1px solid var(--lp-border)',
            borderRadius: '8px',
            overflow: 'hidden',
            fontSize: '0.78rem',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {/* Comment header */}
            <div style={{
              background: 'var(--lp-muted-bg)',
              borderBottom: '1px solid var(--lp-border)',
              padding: '8px 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '22px', height: '22px',
                  background: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#fff', fontFamily: 'Outfit, sans-serif' }}>R</span>
                </div>
                <span style={{ color: 'var(--lp-fg)', fontWeight: 600, fontSize: '0.76rem' }}>ryv-ai</span>
                <span style={{ color: 'var(--lp-muted)', fontSize: '0.72rem' }}>reviewed</span>
                <span style={{ color: 'var(--lp-muted)', fontSize: '0.72rem' }}>payments/charge.ts</span>
              </div>
              <span style={{ color: 'var(--lp-muted)', fontSize: '0.7rem' }}>just now</span>
            </div>

            {/* Diff line */}
            <div style={{
              background: 'rgba(220,38,38,0.07)',
              borderBottom: '1px solid rgba(220,38,38,0.15)',
              padding: '6px 14px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <span style={{ color: '#9CA3AF', fontSize: '0.7rem', userSelect: 'none', minWidth: '28px' }}>+42</span>
              <span style={{ color: '#DC2626' }}>{'+'}</span>
              <span style={{ color: 'var(--lp-fg)' }}>
                {'const apiKey = "sk_live_ab7xKmP9r3Qz...";'}
              </span>
            </div>

            {/* Comment body */}
            <div style={{ padding: '12px 14px' }}>
              <p style={{
                fontFamily: 'DM Sans, sans-serif', fontSize: '0.82rem',
                color: 'var(--lp-fg)', lineHeight: 1.6, margin: '0 0 10px 0',
              }}>
                Hardcoded API key detected on line 42. Secrets committed to source control are a
                critical security risk — rotate this key immediately and use environment variables instead.
              </p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
                  color: '#2563EB', background: 'rgba(37,99,235,0.1)',
                  border: '1px solid rgba(37,99,235,0.25)',
                  padding: '3px 9px', borderRadius: '4px', fontWeight: 600,
                }}>
                  [Rule: no-hardcoded-secrets]
                </span>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
                  color: '#059669', background: 'rgba(5,150,105,0.08)',
                  border: '1px solid rgba(5,150,105,0.2)',
                  padding: '3px 9px', borderRadius: '4px',
                }}>
                  [Confidence: 0.97]
                </span>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
                  color: '#DC2626', background: 'rgba(220,38,38,0.08)',
                  border: '1px solid rgba(220,38,38,0.2)',
                  padding: '3px 9px', borderRadius: '4px',
                }}>
                  BLOCKER
                </span>
              </div>
            </div>

            {/* Second violation */}
            <div style={{
              background: 'rgba(234,179,8,0.06)',
              borderTop: '1px solid var(--lp-border)',
              borderBottom: '1px solid rgba(234,179,8,0.15)',
              padding: '6px 14px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <span style={{ color: '#9CA3AF', fontSize: '0.7rem', userSelect: 'none', minWidth: '28px' }}>+67</span>
              <span style={{ color: '#CA8A04' }}>{'+'}</span>
              <span style={{ color: 'var(--lp-fg)' }}>
                {'export async function charge(amount: any) {'}
              </span>
            </div>
            <div style={{ padding: '12px 14px' }}>
              <p style={{
                fontFamily: 'DM Sans, sans-serif', fontSize: '0.82rem',
                color: 'var(--lp-fg)', lineHeight: 1.6, margin: '0 0 10px 0',
              }}>
                Parameter <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', background: 'var(--lp-muted-bg)', padding: '1px 5px', borderRadius: '3px' }}>amount</code> typed as{' '}
                <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', background: 'var(--lp-muted-bg)', padding: '1px 5px', borderRadius: '3px' }}>any</code>.
                Use a specific type or union to prevent unexpected input values at runtime.
              </p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
                  color: '#2563EB', background: 'rgba(37,99,235,0.1)',
                  border: '1px solid rgba(37,99,235,0.25)',
                  padding: '3px 9px', borderRadius: '4px', fontWeight: 600,
                }}>
                  [Rule: no-any-typescript]
                </span>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
                  color: '#059669', background: 'rgba(5,150,105,0.08)',
                  border: '1px solid rgba(5,150,105,0.2)',
                  padding: '3px 9px', borderRadius: '4px',
                }}>
                  [Confidence: 0.91]
                </span>
              </div>
            </div>
          </div>

          {/* Compact rule analytics */}
          <div className="rules-mockup">
            <div className="rules-mockup-hdr">
              <span>Rule compliance · last 90 days</span>
              <span style={{ color: 'var(--lp-accent)' }}>3 active rules</span>
            </div>
            {rules.map((r) => (
              <div key={r.name} className="rule-row">
                <div className="rule-name">{r.name}</div>
                <div className="rule-bar-wrap">
                  <div className="rule-bar-fill" style={{ width: `${r.pct}%` }} />
                </div>
                <div className="rule-pct">{r.pct}%</div>
                <div className="rule-status">{r.ok ? '✅' : '⚠️'}</div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}

/* ─── Ticket Compliance Section ─────────────────────────────────────────────── */
function TicketSection() {
  const providers = [
    { name: 'Jira', dot: '#0052CC' },
    { name: 'Linear', dot: '#5E6AD2' },
    { name: 'Azure Boards', dot: '#0078D4' },
    { name: 'GitHub Issues', dot: '#24292F' },
  ]

  return (
    <div style={{
      background: 'var(--lp-bg)',
      borderTop: '1px solid var(--lp-border)',
      padding: '88px 0',
    }}>
      <div className="ticket-inner-grid">
        {/* Left: copy */}
        <div>
          <div className="lp-sec-label">Ticket Compliance</div>
          <h2 className="lp-sec-h2">PR review that actually reads your tickets.</h2>
          <p style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: '1rem',
            color: 'var(--lp-muted)', lineHeight: 1.75, marginBottom: '0',
          }}>
            Ryv fetches linked Jira stories, Linear issues, Azure work items, or GitHub Issues —
            then checks each acceptance criterion against the diff. No more PRs that technically
            compile but miss what the ticket actually required.
          </p>

          <div className="ticket-provider-list">
            {providers.map((p) => (
              <div key={p.name} className="ticket-provider-badge">
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: p.dot, flexShrink: 0,
                }} />
                {p.name}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              'Title, description, and acceptance criteria extracted automatically',
              'Injected as ## Linked Tickets section into every LLM prompt',
              'Ticket Compliance Agent checks each criterion against the diff',
              'Flags unaddressed criteria before merge — not after deployment',
            ].map((t) => (
              <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span style={{
                  width: '18px', height: '18px', flexShrink: 0,
                  background: 'rgba(37,99,235,0.1)', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.55rem', color: '#2563EB',
                }}>
                  ✓
                </span>
                <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '0.875rem', color: 'var(--lp-fg)', lineHeight: 1.55 }}>
                  {t}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Ticket mockup */}
        <div className="ticket-mockup">
          <div className="ticket-mockup-hdr">
            <div className="tl-dots">
              <span className="tl tl-r" /><span className="tl tl-y" /><span className="tl tl-g" />
            </div>
            <span>## Linked Tickets · injected context</span>
          </div>
          <div style={{ padding: '18px 20px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', lineHeight: 2 }}>
            <div style={{ color: '#60A5FA', marginBottom: '4px' }}>● SCRUM-441 · Add payment retry logic</div>
            <div style={{ color: 'rgba(248,250,252,0.4)', paddingLeft: '12px' }}>Type: Feature &nbsp;·&nbsp; Priority: High</div>
            <div style={{ color: 'rgba(248,250,252,0.4)', paddingLeft: '12px', marginBottom: '10px' }}>Status: In Progress</div>

            <div style={{ color: 'rgba(248,250,252,0.55)', marginBottom: '6px' }}>Acceptance criteria:</div>
            <div style={{ paddingLeft: '12px', color: '#34D399' }}>
              ✓ &nbsp;Retry on 5xx HTTP with exponential backoff
            </div>
            <div style={{ paddingLeft: '12px', color: '#34D399' }}>
              ✓ &nbsp;Max 3 attempts before dead-letter queue
            </div>
            <div style={{ paddingLeft: '12px', color: '#F87171' }}>
              ✗ &nbsp;Slack alert when retry budget exhausted
            </div>

            <div style={{
              marginTop: '16px', padding: '10px 14px',
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
              borderRadius: '6px', color: '#FBBF24',
            }}>
              ⚠ Partially Compliant — 1 criterion not addressed
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── How It Works ──────────────────────────────────────────────────────────── */
function HowItWorksSection() {
  const steps = [
    {
      n: '01', icon: '🔗',
      title: 'Connect Your Repository',
      desc: 'Add your GitHub or Azure DevOps repo and a personal access token. Ryv uses it to clone your codebase, index symbols, and post review comments directly to your PRs.',
    },
    {
      n: '02', icon: '🕸️',
      title: 'Build the Symbol Graph',
      desc: 'Tree-sitter WASM parses every file in your codebase. Symbols and call edges are stored in Postgres + pgvector. Future pushes trigger fast incremental reindexing.',
    },
    {
      n: '03', icon: '⚡',
      title: 'Get Graph-Aware Reviews',
      desc: 'Every PR webhook triggers 6 agents in parallel. Each gets 2-hop BFS context, ticket criteria, and your team\'s learned rules — then the Judge consolidates and posts.',
    },
  ]

  return (
    <div style={{ background: 'var(--lp-muted-bg)', borderTop: '1px solid var(--lp-border)', borderBottom: '1px solid var(--lp-border)' }}>
      <div className="lp-sec">
        <div className="lp-sec-label">How It Works</div>
        <h2 className="lp-sec-h2">From zero to graph-aware reviews in minutes</h2>
        <p className="lp-sec-sub">
          No CI configuration. No SDK integration. Just connect your repo and Ryv handles the rest.
        </p>
        <div className="steps-grid">
          {steps.map((s) => (
            <div key={s.n} className="step-card">
              <div className="step-num">{s.n}</div>
              <div className="step-icon">{s.icon}</div>
              <div className="step-h3">{s.title}</div>
              <div className="step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Security Section ──────────────────────────────────────────────────────── */
function SecuritySection() {
  const points = [
    'Runs entirely on your infrastructure — no data leaves your environment',
    'Supports air-gapped deployments with local Ollama models',
    'No data retention or telemetry — your code is yours',
    'SOC 2-ready deployment pattern with single docker compose up',
    'Per-org API keys and JWT-based authentication built in',
    'Multi-platform: GitHub and Azure DevOps webhook support',
  ]

  return (
    <section style={{
      background: 'var(--hero-bg)', padding: '80px 0',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '800px', height: '400px',
        background: 'radial-gradient(ellipse, rgba(37,99,235,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div
        className="security-inner-grid"
        style={{
          maxWidth: '1280px', margin: '0 auto', padding: '0 32px',
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: '64px', alignItems: 'center', position: 'relative', zIndex: 1,
        }}
      >
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)',
            color: '#6EE7B7', fontFamily: 'DM Sans, sans-serif', fontSize: '0.72rem',
            fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '5px 12px', borderRadius: '999px', marginBottom: '24px',
          }}>
            <span style={{ color: '#34D399', fontSize: '0.8rem' }}>🛡</span>
            Security-first architecture
          </div>
          <h2 style={{
            fontFamily: 'Outfit, sans-serif',
            fontSize: 'clamp(1.8rem, 3vw, 2.6rem)',
            fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1,
            color: '#F8FAFC', marginBottom: '16px',
          }}>
            Built for teams that can't compromise on data security
          </h2>
          <p style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: '1rem',
            color: 'rgba(248,250,252,0.6)', lineHeight: 1.75, marginBottom: '32px',
          }}>
            Fintech, healthcare, and defense teams choose Ryv because sending source code
            to a third-party AI API simply isn't an option. Ryv runs where your code lives.
          </p>
          <Link
            to="/app"
            style={{
              fontFamily: 'DM Sans, sans-serif', fontSize: '0.95rem', fontWeight: 600,
              color: '#FFFFFF', background: '#2563EB', padding: '13px 28px',
              borderRadius: '8px', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              transition: 'background 0.15s',
            }}
          >
            Deploy in 5 minutes
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {points.map((p) => (
            <div key={p} style={{
              display: 'flex', alignItems: 'flex-start', gap: '14px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px', padding: '14px 18px',
            }}>
              <span style={{
                width: '20px', height: '20px', flexShrink: 0,
                background: 'rgba(16,185,129,0.15)', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6rem', color: '#34D399', marginTop: '1px',
              }}>
                ✓
              </span>
              <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '0.875rem', color: 'rgba(248,250,252,0.75)', lineHeight: 1.55 }}>
                {p}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── Testimonials ──────────────────────────────────────────────────────────── */
function TestimonialsSection() {
  const testimonials = [
    {
      initials: 'SR',
      quote: 'We run Ryv on our fintech monorepo. The blast-radius analysis caught a downstream auth bug that three human reviewers missed. It paid for itself in the first week.',
      name: 'Siddharth Rao',
      role: 'Staff Engineer · Payments Platform',
    },
    {
      initials: 'MA',
      quote: "We're in healthcare — sending code to third-party AI is a non-starter. Ryv with Ollama runs entirely on-prem. Finally, AI code review we can actually use in production.",
      name: 'Maya Adesanya',
      role: 'Engineering Lead · HealthTech',
    },
    {
      initials: 'TK',
      quote: 'The multi-agent architecture is the real differentiator. Security issues caught by the Security Agent, ticket gaps flagged by the Compliance Agent — each review is genuinely thorough.',
      name: 'Tobias Klein',
      role: 'Platform Eng Lead · Series B SaaS',
    },
  ]

  return (
    <div style={{ background: 'var(--lp-bg)', borderTop: '1px solid var(--lp-border)', borderBottom: '1px solid var(--lp-border)' }}>
      <div className="lp-sec">
        <div className="lp-sec-label">Customer Stories</div>
        <h2 className="lp-sec-h2">What engineering teams say</h2>
        <div className="testi-grid-new">
          {testimonials.map((t) => (
            <div key={t.initials} className="testi-card-new">
              <div style={{ display: 'flex', gap: '2px', marginBottom: '16px' }}>
                {[1,2,3,4,5].map(i => (
                  <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#F59E0B">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ))}
              </div>
              <p className="testi-quote">"{t.quote}"</p>
              <div className="testi-author-new">
                <div className="testi-av-new">{t.initials}</div>
                <div>
                  <div className="testi-name-new">{t.name}</div>
                  <div className="testi-role-new">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── FAQ Section ────────────────────────────────────────────────────────────── */
function FAQSection() {
  const faqs = [
    {
      q: 'Is Ryv really 100% self-hosted?',
      a: 'Yes. One docker compose up spins up Postgres + pgvector, the API server, and optionally Ollama. Your code never leaves your network unless you explicitly choose a cloud LLM provider.',
    },
    {
      q: 'Which LLMs does Ryv support?',
      a: 'Ollama (local, any model), OpenAI, Claude (Anthropic), and Azure OpenAI for generation. Any OpenAI-compatible embedding endpoint — including fully local models. Switch providers by changing two env vars.',
    },
    {
      q: 'What version control platforms are supported?',
      a: 'GitHub and Azure DevOps are fully supported via webhooks. Both trigger on PR creation and push events. GitLab is on the v3 roadmap.',
    },
    {
      q: 'How does graph-aware review work?',
      a: 'Tree-sitter WASM parses every file into a symbol + call graph stored in Postgres. On each PR webhook, Ryv performs 2-hop BFS from changed symbols — giving the LLM full blast radius context, not just the diff.',
    },
    {
      q: 'What languages are supported?',
      a: 'TypeScript, JavaScript, Python, Java, Go, and C#. Grammar files are Tree-sitter WASM — additional languages can be added without native compilation.',
    },
    {
      q: 'How does the Rules System work?',
      a: 'Define rules in plain English via the dashboard. Ryv injects active rules into every LLM prompt and cites violations inline as "Rule: <name>". Per-rule analytics track adoption rates and violation trends over time.',
    },
  ]

  return (
    <div style={{ background: 'var(--lp-muted-bg)', borderTop: '1px solid var(--lp-border)' }}>
      <div className="lp-sec">
        <div className="lp-sec-label">FAQ</div>
        <h2 className="lp-sec-h2">Frequently asked questions</h2>
        <p className="lp-sec-sub">
          Everything engineering and security teams ask before deploying Ryv.
        </p>
        <div className="faq-grid">
          {faqs.map((f) => (
            <div key={f.q} className="faq-item">
              <div className="faq-q">{f.q}</div>
              <div className="faq-a">{f.a}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── CTA ────────────────────────────────────────────────────────────────────── */
function CtaSection() {
  return (
    <section style={{
      background: 'var(--hero-bg)', padding: '96px 0',
      textAlign: 'center', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '600px', height: '300px',
        background: 'radial-gradient(ellipse, rgba(37,99,235,0.2) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{ maxWidth: '700px', margin: '0 auto', padding: '0 32px', position: 'relative', zIndex: 1 }}>
        <h2 style={{
          fontFamily: 'Outfit, sans-serif', fontSize: 'clamp(2rem, 4vw, 3rem)',
          fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1,
          color: '#F8FAFC', marginBottom: '16px',
        }}>
          Ready to ship with{' '}
          <span style={{
            background: 'linear-gradient(135deg, #60A5FA 0%, #06B6D4 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            full confidence?
          </span>
        </h2>
        <p style={{
          fontFamily: 'DM Sans, sans-serif', fontSize: '1rem',
          color: 'rgba(248,250,252,0.6)', lineHeight: 1.7, marginBottom: '40px',
        }}>
          No cloud. No config. Graph-aware, multi-agent reviews on every PR in under five minutes.
        </p>

        <div className="cta-install">
          <span style={{ color: '#06B6D4' }}>$</span>
          <code>docker compose up --build</code>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            to="/app"
            style={{
              fontFamily: 'DM Sans, sans-serif', fontSize: '0.95rem', fontWeight: 600,
              color: '#FFFFFF', background: '#2563EB', padding: '13px 32px',
              borderRadius: '8px', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              transition: 'background 0.15s',
            }}
          >
            Get Started Free
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
          <a
            href="/docs/"
            style={{
              fontFamily: 'DM Sans, sans-serif', fontSize: '0.95rem', fontWeight: 600,
              color: 'rgba(248,250,252,0.8)', background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.15)', padding: '13px 32px',
              borderRadius: '8px', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              transition: 'background 0.15s',
            }}
          >
            Read the Docs
          </a>
        </div>
      </div>
    </section>
  )
}

/* ─── Footer ─────────────────────────────────────────────────────────────────── */
function LandingFooter() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS]

  const footerLinks = {
    Product: [
      { label: 'Features', href: '#features' },
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Pricing', href: '/docs/pricing' },
      { label: 'Changelog', href: '/docs/changelog' },
    ],
    Resources: [
      { label: 'Documentation', href: '/docs/' },
      { label: 'GitHub', href: APP_GITHUB_URL },
      { label: 'API Reference', href: '/docs/api' },
      { label: 'Self-Hosting Guide', href: '/docs/self-hosting' },
    ],
    Company: [
      { label: 'About', href: '/about' },
      { label: 'Security', href: '/security' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  }

  return (
    <footer className="lp-footer">
      <div
        className="lp-footer-grid"
        style={{
          maxWidth: '1280px', margin: '0 auto', padding: '56px 32px 40px',
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '48px',
        }}
      >
        {/* Brand */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{
              width: '28px', height: '28px',
              background: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)',
              borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '0.85rem', color: '#fff' }}>R</span>
            </div>
            <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '1.05rem', color: '#F8FAFC', letterSpacing: '-0.02em' }}>{APP_NAME}</span>
          </div>
          <p style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: '0.85rem',
            color: 'rgba(248,250,252,0.45)', lineHeight: 1.7, maxWidth: '280px',
          }}>
            {APP_NAME} — graph-aware, self-hosted, MIT licensed code review.
          </p>
          <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <a
              href={APP_GITHUB_URL}
              target="_blank" rel="noopener noreferrer"
              style={{
                width: '32px', height: '32px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(248,250,252,0.5)', fontSize: '0.85rem', textDecoration: 'none',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              ⌥
            </a>
          </div>
        </div>

        {Object.entries(footerLinks).map(([title, links]) => (
          <div key={title}>
            <div style={{
              fontFamily: 'DM Sans, sans-serif', fontSize: '0.7rem', fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'rgba(248,250,252,0.35)', marginBottom: '16px',
            }}>
              {title}
            </div>
            {links.map((l) => (
              <a key={l.label} href={l.href} className="footer-link">{l.label}</a>
            ))}
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div style={{
        maxWidth: '1280px', margin: '0 auto', padding: '0 32px 24px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '20px',
      }}>
        <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '0.8rem', color: 'rgba(248,250,252,0.3)' }}>
          © {new Date().getFullYear()} {APP_NAME}. MIT Licensed. Open Source.
        </span>
        <div style={{ display: 'flex', gap: '20px' }}>
          <a href="/privacy" className="footer-link" style={{ marginBottom: 0 }}>Privacy</a>
          <a href="/terms" className="footer-link" style={{ marginBottom: 0 }}>Terms</a>
        </div>
      </div>

      {/* Ticker */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div
          className="animate-ticker"
          style={{ display: 'flex', width: 'max-content' }}
          onMouseEnter={e => (e.currentTarget.style.animationPlayState = 'paused')}
          onMouseLeave={e => (e.currentTarget.style.animationPlayState = 'running')}
        >
          {items.map((item, i) => (
            <span
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '11px 22px', fontFamily: 'DM Sans, monospace',
                fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                fontWeight: 600, color: 'rgba(248,250,252,0.28)',
                borderRight: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: '#2563EB', fontSize: '0.4rem' }}>◆</span>
              {item}
            </span>
          ))}
        </div>
      </div>
    </footer>
  )
}
