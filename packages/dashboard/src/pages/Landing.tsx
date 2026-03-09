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
    <div className="hero">
      {/* Left: copy */}
      <div>
        <div className="hero-file-comment">
          <div className="tl-dots">
            <span className="tl tl-r" /><span className="tl tl-y" /><span className="tl tl-g" />
          </div>
          <span className="syn-cmt">
            {'// now shipping: multi-agent review + ticket compliance'}
          </span>
        </div>
        <div className="hero-prompt">&gt;_</div>
        <h1>
          AI reviews that see<br />the <em>whole picture.</em>
        </h1>
        <div className="hero-code-block lp-mono">
          <span className="syn-kw">const</span>{' '}review = {'{'}<br />
          {'\u00A0\u00A0'}agents:{'\u00A0\u00A0\u00A0\u00A0\u00A0'}<span className="syn-num">6</span>,{'\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'}<span className="syn-cmt">// specialist + judge</span><br />
          {'\u00A0\u00A0'}blastRadius:{' '}<span className="syn-num">4</span>,{'\u00A0\u00A0\u00A0\u00A0'}<span className="syn-cmt">// callers affected</span><br />
          {'\u00A0\u00A0'}depth:{'\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'}<span className="syn-str">"2-hop"</span>,{'\u00A0\u00A0'}<span className="syn-cmt">// BFS traversal</span><br />
          {'\u00A0\u00A0'}llm:{'\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'}<span className="syn-str">"ollama"</span>{' '}<span className="syn-cmt">// or openai, claude</span><br />
          {'}'}
        </div>
        <div className="hero-desc lp-mono">
          {'/**'}<br />
          {'\u00A0* Ryv indexes your codebase with Tree-sitter,'}<br />
          {'\u00A0* fans out to 6 AI agents in parallel, and reviews'}<br />
          {'\u00A0* every PR with full blast-radius context.'}<br />
          {'\u00A0*/'}
        </div>
        <div className="hero-ctas">
          <Link to="/app" className="btn-p">$ open --app →</Link>
          <a href={APP_GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn-g">$ git clone</a>
        </div>
      </div>

      {/* Right: GraphViz + review result panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <GraphViz />
        <div className="graph-panel">
          <div className="graph-tbar">
            <div className="tl-dots">
              <span className="tl tl-r" /><span className="tl tl-y" /><span className="tl tl-g" />
            </div>
            <span className="graph-fname">review-result.json</span>
            <span className="graph-badge">request_changes</span>
          </div>
          <div className="lp-mono" style={{ padding: '14px 18px', fontSize: '0.72rem', lineHeight: 1.75 }}>
            <span className="syn-cmt">{'// PR #247 — payments/charge.ts'}</span><br />
            <span className="syn-kw">const</span>{' '}result = {'{'}<br />
            {'\u00A0\u00A0'}blastRadius: <span className="syn-num">4</span>,{' '}<span className="syn-cmt">// callers affected</span><br />
            {'\u00A0\u00A0'}agents: <span className="syn-str">"sec · perf · blast"</span>,<br />
            {'\u00A0\u00A0'}comments: <span className="syn-num">3</span>,{' '}<span className="syn-cmt">// confidence ≥ 0.91</span><br />
            {'\u00A0\u00A0'}ticket: <span className="syn-str">"partial"</span><br />
            {'}'}
          </div>
          <div className="graph-foot">
            <div className="gstat"><span>6</span> agents</div>
            <div className="gstat"><span>3</span> comments</div>
            <div className="gstat">blast radius <span>4</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Metrics Bar ───────────────────────────────────────────────────────────── */
function MetricsBar() {
  const stats = [
    { num: '6', suf: '', label: 'Specialist Agents' },
    { num: '6', suf: '+', label: 'Languages' },
    { num: '4', suf: '', label: 'LLM Providers' },
    { num: '2', suf: '-hop', label: 'Graph Depth (BFS)' },
    { num: 'MIT', suf: '', label: 'License' },
    { num: '0', suf: ' bytes', label: 'Data Egress (self-hosted)' },
  ]
  return (
    <div className="trust">
      <div className="trust-inner">
        {stats.map((s) => (
          <div key={s.label} className="tstat">
            <div className="tstat-num">{s.num}<em>{s.suf}</em></div>
            <div className="tstat-label">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Multi-Agent Section ───────────────────────────────────────────────────── */
function MultiAgentSection() {
  const agents = [
    { icon: '🔒', tag: 'Security', name: 'Security Agent',
      desc: 'XSS vectors, SQL injection, insecure deserialization, auth bypass, and secrets accidentally committed in diffs.' },
    { icon: '✅', tag: 'Correctness', name: 'Correctness Agent',
      desc: 'Logic errors, unreachable branches, null/undefined edge cases, off-by-one errors, and type safety gaps.' },
    { icon: '⚡', tag: 'Performance', name: 'Performance Agent',
      desc: 'Hotpath allocations, N+1 database queries, unnecessary re-renders, and cache invalidation anti-patterns.' },
    { icon: '🎨', tag: 'Style', name: 'Style & Maintainability',
      desc: "Naming conventions, DRY violations, excessive complexity, dead code, and patterns that violate your team's rules." },
    { icon: '🎟️', tag: 'Compliance', name: 'Ticket Compliance',
      desc: 'Fetches acceptance criteria from Jira, Linear, Azure Boards, or GitHub Issues and checks if the diff delivers them.' },
    { icon: '🕸️', tag: 'Graph', name: 'Blast Radius Agent',
      desc: 'Reads the 2-hop BFS traversal output and flags callers and callees that are at risk from the changed symbols.' },
  ]

  return (
    <div style={{ background: 'var(--lp-muted-bg)', borderTop: '1px solid var(--lp-border)', borderBottom: '1px solid var(--lp-border)' }}>
      <div className="sec">
        <p className="sec-label">{'// multi-agent architecture'}</p>
        <h2 className="sec-h2">6 specialist agents. One judge.</h2>
        <p className="sec-sub">
          Unlike single-pass reviewers, Ryv fans out to 6 agents running in parallel — each focused
          on one concern. A Judge pass consolidates findings and eliminates false positives before any
          comment reaches your developers.
        </p>
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
        <div className="judge-card">
          <div className="judge-icon">⚖️</div>
          <div>
            <div style={{ fontFamily: 'sans-serif', fontSize: '0.88rem', fontWeight: 700, marginBottom: '6px' }}>
              Judge Agent — consolidation &amp; deduplication
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--lp-muted)', lineHeight: 1.7 }}>
              Runs deterministic fingerprint deduplication first, then an optional LLM pass to resolve
              conflicts and re-rank by impact. Configurable via{' '}
              <span className="syn-num lp-mono">JUDGE_ENABLED</span>,{' '}
              <span className="syn-num lp-mono">JUDGE_MODE</span>, and{' '}
              <span className="syn-num lp-mono">AGENT_CONCURRENCY</span>.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Comparison ────────────────────────────────────────────────────────────── */
function ComparisonSection() {
  const withoutRyv = [
    'Sees changed lines only — no caller context',
    'Re-reviews unchanged code on every push',
    'Misses breaking changes in downstream callers',
    'Single-pass review — all concerns lumped together',
    'Noisy, low-confidence speculative comments',
    'Fixed review style — never learns your team',
    'Code sent to third-party cloud API',
    'Ticket compliance checked manually by reviewers',
  ]
  const withRyv = [
    '2-hop BFS surfaces callers, callees, blast radius',
    'Incremental — only re-reviews new commits',
    'Flags affected downstream functions before merge',
    '6 specialist agents run in parallel, Judge consolidates',
    'Precision filter drops comments below confidence threshold',
    "RAG loop learns from your team's accepted comments",
    '100% self-hosted — zero data egress option',
    'Jira · Linear · Azure Boards · GitHub Issues built-in',
  ]

  return (
    <div className="sec">
      <p className="sec-label">{'// without vs with ryv'}</p>
      <h2 className="sec-h2">Flat diff reviews leave you exposed</h2>
      <p className="sec-sub">
        Most AI code reviewers see only the changed lines. They miss what breaks downstream,
        flood PRs with low-confidence noise, and send your proprietary code to third-party APIs.
      </p>
      <div className="diff-wrap">
        <div className="diff-header">
          <div className="tl-dots">
            <span className="tl tl-r" /><span className="tl tl-y" /><span className="tl tl-g" />
          </div>
          <span className="diff-fname">review-comparison.diff</span>
        </div>
        <div className="diff-body">
          <div className="diff-col">
            <div className="diff-col-hdr">without-ryv.ts</div>
            {withoutRyv.map((t) => (
              <div key={t} className="diff-line dl-del">
                <span className="sign">–</span><span>{t}</span>
              </div>
            ))}
          </div>
          <div className="diff-col">
            <div className="diff-col-hdr">with-ryv.ts</div>
            {withRyv.map((t) => (
              <div key={t} className="diff-line dl-add">
                <span className="sign">+</span><span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Features ──────────────────────────────────────────────────────────────── */
function FeaturesSection() {
  const features = [
    { icon: '🔍', tag: '2-Hop BFS', title: 'Graph-Aware Blast Radius',
      desc: 'Tree-sitter builds a live dependency graph. Ryv traverses 2 hops to surface every caller and callee affected by a change — before the LLM writes a single comment.' },
    { icon: '🤖', tag: '6 Agents + Judge', title: 'Multi-Agent Specialist Review',
      desc: 'Security, correctness, performance, style, ticket compliance, and blast radius agents run concurrently. A Judge pass deduplicates and ranks findings by impact.' },
    { icon: '📋', tag: 'Rules · Analytics', title: 'Rules System & Governance',
      desc: 'Define standards in plain English. Rules are enforced on every PR, cited inline in comments, and tracked with per-rule adoption rates and violation trends.' },
    { icon: '🎟️', tag: 'Jira · Linear · Azure', title: 'Ticket Compliance',
      desc: 'Pulls acceptance criteria from Jira, Linear, Azure Boards, or GitHub Issues and checks each criterion against the diff — so nothing slips through unreviewed.' },
    { icon: '📝', tag: 'PR Automation', title: 'PR Description & Labels',
      desc: 'Automatically writes back the PR title, prose summary, file-by-file walkthrough, change type, and labels — reducing reviewer onboarding time on every PR.' },
    { icon: '🏠', tag: 'Self-Hosted', title: 'Your Code Never Leaves',
      desc: 'One docker compose up. Postgres, pgvector, and Ollama run on your infrastructure. No third-party API calls. Built for teams with strict data compliance requirements.' },
    { icon: '🧠', tag: 'RAG · Per-Repo', title: 'Learns From Your Team',
      desc: "Every accepted review comment is embedded and stored. Future reviews inject your team's top-rated examples into the prompt. The more you use it, the better it gets." },
    { icon: '🎯', tag: 'Signal / Noise', title: 'Precision Filter',
      desc: 'The LLM self-scores every comment with a confidence value. Anything below your threshold is silently dropped — only high-signal findings reach your developers.' },
    { icon: '⚡', tag: 'Incremental', title: 'Fast Incremental Reviews',
      desc: 'Checkpoints prevent re-reviewing unchanged commits. On GitHub and Azure DevOps, only new commits since the last review are processed — keeping costs minimal.' },
  ]

  return (
    <div style={{ borderTop: '1px solid var(--lp-border)', borderBottom: '1px solid var(--lp-border)', background: 'var(--lp-card-bg)' }}>
      <div className="sec">
        <p className="sec-label">{'// what makes it different'}</p>
        <h2 className="sec-h2">Everything you need to ship with confidence</h2>
        <p className="sec-sub">
          Built for engineering teams who take code quality seriously — from solo startups to
          enterprise teams with the strictest security requirements.
        </p>
        <div className="feat-grid">
          {features.map((f) => (
            <div key={f.title} className="feat-card">
              <div className="feat-icon">{f.icon}</div>
              <div className="feat-title">{f.title}</div>
              <div className="feat-desc">{f.desc}</div>
              <span className="feat-tag">{f.tag}</span>
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
  const points = [
    { icon: '📝', text: 'Plain-English rules — no regex, no DSL, no config files' },
    { icon: '🔌', text: 'Injected as "## Enforced Rules" directly into the LLM prompt' },
    { icon: '💬', text: 'Violations cited inline: [Rule: no-hardcoded-secrets] [Confidence: 0.97]' },
    { icon: '📊', text: 'Per-rule compliance tracking: adoption rate, trend, CSV export' },
  ]

  return (
    <div style={{ borderTop: '1px solid var(--lp-border)' }}>
      <div className="two-col-sec">
        {/* Left: copy */}
        <div>
          <p className="sec-label">{'// rules system'}</p>
          <h2 className="sec-h2">Write it once.<br />Enforce it on every PR.</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--lp-muted)', lineHeight: 1.8, marginBottom: '28px' }}>
            Define team standards in plain English. Ryv injects them directly into the review prompt —
            so every PR gets the same level of scrutiny, and violations are cited right inside the
            comment with the rule name.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
            {points.map((p) => (
              <div key={p.icon} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span>{p.icon}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--lp-fg)', lineHeight: 1.6 }}>{p.text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <a href="/docs/reference/rules" style={{ fontSize: '0.72rem', color: 'var(--lp-accent)', textDecoration: 'none' }}>
              Rules reference docs →
            </a>
            <a href="/docs/reference/rules#examples" style={{ fontSize: '0.72rem', color: 'var(--lp-muted)', textDecoration: 'none' }}>
              See example rules →
            </a>
          </div>
        </div>

        {/* Right: PR comment mockup + analytics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* GitHub-style PR comment */}
          <div style={{ border: '1px solid var(--lp-border)', overflow: 'hidden', background: 'var(--lp-card-bg)' }}>
            <div style={{ background: 'var(--lp-muted-bg)', borderBottom: '1px solid var(--lp-border)', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '20px', height: '20px', background: 'var(--lp-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.58rem', fontWeight: 800, color: 'var(--lp-bg)', fontFamily: 'sans-serif' }}>R</span>
                </div>
                <span className="lp-mono" style={{ fontSize: '0.72rem', fontWeight: 600 }}>ryv-ai</span>
                <span className="syn-cmt lp-mono" style={{ fontSize: '0.68rem' }}>reviewed payments/charge.ts</span>
              </div>
              <span className="syn-cmt lp-mono" style={{ fontSize: '0.65rem' }}>just now</span>
            </div>
            {/* Diff line 1 — hardcoded secret */}
            <div className="lp-mono" style={{ background: 'color-mix(in srgb, #DC2626 6%, var(--lp-bg) 94%)', borderBottom: '1px solid var(--lp-border)', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--lp-muted)', fontSize: '0.68rem', minWidth: '28px' }}>+42</span>
              <span style={{ color: '#DC2626' }}>+</span>
              <span style={{ fontSize: '0.7rem' }}>{'const apiKey = "sk_live_ab7xKmP9r3Qz...";'}</span>
            </div>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--lp-border)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--lp-fg)', lineHeight: 1.6, margin: '0 0 8px 0' }}>
                Hardcoded API key detected on line 42. Rotate this key immediately and use environment variables instead.
              </p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span className="lp-mono" style={{ fontSize: '0.62rem', color: 'var(--lp-accent)', border: '1px solid color-mix(in srgb, var(--lp-accent) 35%, transparent)', padding: '2px 7px' }}>[Rule: no-hardcoded-secrets]</span>
                <span className="lp-mono" style={{ fontSize: '0.62rem', color: 'var(--syn-str)', border: '1px solid color-mix(in srgb, var(--syn-str) 35%, transparent)', padding: '2px 7px' }}>[Confidence: 0.97]</span>
                <span className="lp-mono" style={{ fontSize: '0.62rem', color: '#DC2626', border: '1px solid rgba(220,38,38,0.3)', padding: '2px 7px' }}>BLOCKER</span>
              </div>
            </div>
            {/* Diff line 2 — any type */}
            <div className="lp-mono" style={{ background: 'color-mix(in srgb, #CA8A04 4%, var(--lp-bg) 96%)', borderBottom: '1px solid var(--lp-border)', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--lp-muted)', fontSize: '0.68rem', minWidth: '28px' }}>+67</span>
              <span style={{ color: '#CA8A04' }}>+</span>
              <span style={{ fontSize: '0.7rem' }}>{'export async function charge(amount: any) {'}</span>
            </div>
            <div style={{ padding: '10px 14px' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--lp-fg)', lineHeight: 1.6, margin: '0 0 8px 0' }}>
                Parameter <code className="lp-mono" style={{ background: 'var(--lp-muted-bg)', padding: '1px 4px', fontSize: '0.68rem' }}>amount</code> typed as <code className="lp-mono" style={{ background: 'var(--lp-muted-bg)', padding: '1px 4px', fontSize: '0.68rem' }}>any</code>. Use a specific type or union to prevent unexpected input values.
              </p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span className="lp-mono" style={{ fontSize: '0.62rem', color: 'var(--lp-accent)', border: '1px solid color-mix(in srgb, var(--lp-accent) 35%, transparent)', padding: '2px 7px' }}>[Rule: no-any-typescript]</span>
                <span className="lp-mono" style={{ fontSize: '0.62rem', color: 'var(--syn-str)', border: '1px solid color-mix(in srgb, var(--syn-str) 35%, transparent)', padding: '2px 7px' }}>[Confidence: 0.91]</span>
              </div>
            </div>
          </div>

          {/* Rule analytics */}
          <div className="rules-mockup">
            <div className="rules-mockup-hdr">
              <span className="lp-mono">rule compliance · last 90 days</span>
              <span style={{ color: 'var(--lp-accent)' }}>3 active rules</span>
            </div>
            {rules.map((r) => (
              <div key={r.name} className="rule-row">
                <div className="rule-name lp-mono">{r.name}</div>
                <div className="rule-bar-wrap"><div className="rule-bar-fill" style={{ width: `${r.pct}%` }} /></div>
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
  const points = [
    'Title, description, and acceptance criteria extracted automatically',
    'Injected as ## Linked Tickets section into every LLM prompt',
    'Ticket Compliance Agent checks each criterion against the diff',
    'Flags unaddressed criteria before merge — not after deployment',
  ]

  return (
    <div style={{ background: 'var(--lp-muted-bg)', borderTop: '1px solid var(--lp-border)', borderBottom: '1px solid var(--lp-border)' }}>
      <div className="two-col-sec">
        {/* Left: copy */}
        <div>
          <p className="sec-label">{'// ticket compliance'}</p>
          <h2 className="sec-h2">PR review that actually reads your tickets.</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--lp-muted)', lineHeight: 1.8, marginBottom: '0' }}>
            Ryv fetches linked Jira stories, Linear issues, Azure work items, or GitHub Issues — then
            checks each acceptance criterion against the diff. No more PRs that technically compile
            but miss what the ticket actually required.
          </p>
          <div className="ticket-provider-list">
            {providers.map((p) => (
              <div key={p.name} className="ticket-provider-badge">
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: p.dot, flexShrink: 0 }} />
                {p.name}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {points.map((t) => (
              <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span className="syn-num lp-mono" style={{ fontSize: '0.7rem', flexShrink: 0 }}>✓</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--lp-fg)', lineHeight: 1.6 }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: terminal mockup */}
        <div style={{ background: 'var(--lp-hdr-bg)', border: '1px solid var(--lp-hdr-border)', overflow: 'hidden' }}>
          <div style={{ background: 'color-mix(in srgb, var(--lp-hdr-bg) 60%, var(--lp-hdr-border) 40%)', borderBottom: '1px solid var(--lp-hdr-border)', padding: '9px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="tl-dots">
              <span className="tl tl-r" /><span className="tl tl-y" /><span className="tl tl-g" />
            </div>
            <span className="lp-mono" style={{ fontSize: '0.62rem', color: 'color-mix(in srgb, var(--lp-hdr-fg) 38%, transparent)' }}>{'## Linked Tickets · injected context'}</span>
          </div>
          <div className="lp-mono" style={{ padding: '18px 20px', fontSize: '0.72rem', lineHeight: 2 }}>
            <div style={{ color: 'var(--lp-accent)', marginBottom: '4px' }}>● SCRUM-441 · Add payment retry logic</div>
            <div style={{ color: 'color-mix(in srgb, var(--lp-hdr-fg) 40%, transparent)', paddingLeft: '12px' }}>Type: Feature &nbsp;·&nbsp; Priority: High</div>
            <div style={{ color: 'color-mix(in srgb, var(--lp-hdr-fg) 40%, transparent)', paddingLeft: '12px', marginBottom: '10px' }}>Status: In Progress</div>
            <div style={{ color: 'color-mix(in srgb, var(--lp-hdr-fg) 55%, transparent)', marginBottom: '6px' }}>Acceptance criteria:</div>
            <div style={{ paddingLeft: '12px', color: 'var(--syn-str)' }}>✓ &nbsp;Retry on 5xx HTTP with exponential backoff</div>
            <div style={{ paddingLeft: '12px', color: 'var(--syn-str)' }}>✓ &nbsp;Max 3 attempts before dead-letter queue</div>
            <div style={{ paddingLeft: '12px', color: '#F87171' }}>✗ &nbsp;Slack alert when retry budget exhausted</div>
            <div style={{ marginTop: '16px', padding: '10px 14px', border: '1px solid color-mix(in srgb, #FBBF24 30%, transparent)', color: '#FBBF24', fontSize: '0.68rem' }}>
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
    { n: '01', icon: '🔗', title: 'Connect Your Repository',
      desc: 'Add your GitHub or Azure DevOps repo and a personal access token. Ryv uses it to clone your codebase, index symbols, and post review comments directly to your PRs.' },
    { n: '02', icon: '🕸️', title: 'Build the Symbol Graph',
      desc: 'Tree-sitter WASM parses every file in your codebase. Symbols and call edges are stored in Postgres + pgvector. Future pushes trigger fast incremental reindexing.' },
    { n: '03', icon: '⚡', title: 'Get Graph-Aware Reviews',
      desc: "Every PR webhook triggers 6 agents in parallel. Each gets 2-hop BFS context, ticket criteria, and your team's learned rules — then the Judge consolidates and posts." },
  ]

  return (
    <div style={{ borderTop: '1px solid var(--lp-border)' }}>
      <div className="sec">
        <p className="sec-label">{'// how it works'}</p>
        <h2 className="sec-h2">From zero to graph-aware reviews in minutes</h2>
        <p className="sec-sub">No CI configuration. No SDK integration. Just connect your repo and Ryv handles the rest.</p>
        <div className="how-grid">
          {steps.map((s) => (
            <div key={s.n} className="how-step">
              <div className="how-n">{s.n}</div>
              <div className="how-icon">{s.icon}</div>
              <div className="how-title">{s.title}</div>
              <div className="how-desc">{s.desc}</div>
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
    <div style={{ background: 'var(--lp-hdr-bg)', borderTop: '1px solid var(--lp-hdr-border)', borderBottom: '1px solid var(--lp-hdr-border)' }}>
      <div className="two-col-sec" style={{ alignItems: 'center' }}>
        {/* Left: copy */}
        <div>
          <div className="lp-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid color-mix(in srgb, var(--syn-str) 30%, transparent)', padding: '4px 12px', marginBottom: '20px', fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--syn-str)' }}>
            🛡 Security-first architecture
          </div>
          <h2 style={{ fontFamily: 'sans-serif', fontSize: 'clamp(1.8rem, 3vw, 2.6rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, color: 'var(--lp-hdr-fg)', marginBottom: '16px' }}>
            Built for teams that can't compromise on data security.
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'color-mix(in srgb, var(--lp-hdr-fg) 60%, transparent)', lineHeight: 1.8, marginBottom: '28px' }}>
            Fintech, healthcare, and defense teams choose Ryv because sending source code to a third-party
            AI API simply isn't an option. Ryv runs where your code lives.
          </p>
          <Link to="/app" className="btn-p" style={{ background: 'var(--lp-accent)', borderColor: 'var(--lp-accent)', color: '#fff' }}>
            $ deploy in 5 minutes →
          </Link>
        </div>

        {/* Right: security checklist */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {points.map((p) => (
            <div key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', border: '1px solid color-mix(in srgb, var(--lp-hdr-fg) 10%, transparent)', padding: '12px 16px' }}>
              <span className="lp-mono" style={{ color: 'var(--syn-str)', fontSize: '0.65rem', flexShrink: 0, marginTop: '1px' }}>✓</span>
              <span style={{ fontSize: '0.72rem', color: 'color-mix(in srgb, var(--lp-hdr-fg) 75%, transparent)', lineHeight: 1.6 }}>{p}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Testimonials ──────────────────────────────────────────────────────────── */
function TestimonialsSection() {
  return (
    <div className="testi-bg">
      <div className="sec">
        <p className="sec-label">{'// what engineering teams say'}</p>
        <div className="testi-grid">
          <div className="testi-card">
            <div className="testi-comment-hdr lp-mono">{'/** @author Siddharth Rao · Staff Eng, Payments */'}</div>
            <p className="testi-text">
              We run Ryv on our fintech monorepo. The blast-radius analysis caught a downstream auth bug
              that three human reviewers missed. It paid for itself in the first week.
            </p>
            <div className="testi-author">
              <div className="testi-av">SR</div>
              <div>
                <div className="testi-name">Siddharth Rao</div>
                <div className="testi-role">Staff Engineer · Payments Platform</div>
              </div>
            </div>
          </div>
          <div className="testi-card">
            <div className="testi-comment-hdr lp-mono">{'/** @author Maya Adesanya · Eng Lead, HealthTech */'}</div>
            <p className="testi-text">
              We're in healthcare — sending code to third-party AI is a non-starter. Ryv with Ollama
              runs entirely on-prem. Finally, AI code review we can actually use in production.
            </p>
            <div className="testi-author">
              <div className="testi-av">MA</div>
              <div>
                <div className="testi-name">Maya Adesanya</div>
                <div className="testi-role">Engineering Lead · HealthTech</div>
              </div>
            </div>
          </div>
          <div className="testi-card">
            <div className="testi-comment-hdr lp-mono">{'/** @author Tobias Klein · Platform Lead, SaaS */'}</div>
            <p className="testi-text">
              The multi-agent architecture is the real differentiator. Security issues, ticket gaps,
              blast radius — each review is genuinely thorough. Nothing like a single-pass reviewer.
            </p>
            <div className="testi-author">
              <div className="testi-av">TK</div>
              <div>
                <div className="testi-name">Tobias Klein</div>
                <div className="testi-role">Platform Eng Lead · Series B SaaS</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── FAQ Section ────────────────────────────────────────────────────────────── */
function FAQSection() {
  const faqs = [
    { q: 'Is Ryv really 100% self-hosted?',
      a: 'Yes. One docker compose up spins up Postgres + pgvector, the API server, and optionally Ollama. Your code never leaves your network unless you explicitly choose a cloud LLM provider.' },
    { q: 'Which LLMs does Ryv support?',
      a: 'Ollama (local, any model), OpenAI, Claude (Anthropic), and Azure OpenAI for generation. Any OpenAI-compatible embedding endpoint — including fully local models. Switch providers by changing two env vars.' },
    { q: 'What version control platforms are supported?',
      a: 'GitHub and Azure DevOps are fully supported via webhooks. Both trigger on PR creation and push events. GitLab is on the v3 roadmap.' },
    { q: 'How does graph-aware review work?',
      a: 'Tree-sitter WASM parses every file into a symbol + call graph stored in Postgres. On each PR webhook, Ryv performs 2-hop BFS from changed symbols — giving the LLM full blast radius context, not just the diff.' },
    { q: 'What languages are supported?',
      a: 'TypeScript, JavaScript, Python, Java, Go, and C#. Grammar files are Tree-sitter WASM — additional languages can be added without native compilation.' },
    { q: 'How does the Rules System work?',
      a: 'Define rules in plain English via the dashboard. Ryv injects active rules into every LLM prompt and cites violations inline as "[Rule: name]". Per-rule analytics track adoption rates and violation trends over time.' },
  ]

  return (
    <div style={{ borderTop: '1px solid var(--lp-border)', background: 'var(--lp-card-bg)' }}>
      <div className="sec">
        <p className="sec-label">{'// faq'}</p>
        <h2 className="sec-h2">Frequently asked questions</h2>
        <p className="sec-sub">Everything engineering and security teams ask before deploying Ryv.</p>
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
    <div className="sec-top">
      <div className="cta-sec">
        <div>
          <h2 className="cta-h">
            Ship with<br /><em>full confidence.</em>
          </h2>
        </div>
        <div>
          <div className="cta-install lp-mono">
            <span className="pr" style={{ color: 'var(--syn-prompt)' }}>$</span>
            <code>docker compose up --build</code>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--lp-muted)', marginBottom: '20px', lineHeight: 1.7 }}>
            <span className="syn-cmt lp-mono">{'// No cloud. No config. Graph-aware, multi-agent reviews on every PR in under five minutes.'}</span>
          </p>
          <div className="hero-ctas">
            <Link to="/app" className="btn-p">$ open --app →</Link>
            <a href="/docs/" className="btn-g">$ man docs</a>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Footer ─────────────────────────────────────────────────────────────────── */
function LandingFooter() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS]
  const footerLinks = {
    Product: [
      { label: 'Features', href: '#features' },
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Changelog', href: '/docs/changelog' },
    ],
    Resources: [
      { label: 'Documentation', href: '/docs/' },
      { label: 'GitHub', href: APP_GITHUB_URL },
      { label: 'API Reference', href: '/docs/api' },
      { label: 'Self-Hosting', href: '/docs/self-hosting' },
    ],
    Company: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Security', href: '/security' },
    ],
  }

  return (
    <footer className="lp-footer">
      <div className="lp-footer-grid">
        {/* Brand */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <div style={{ width: '22px', height: '22px', background: 'var(--lp-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: '0.8rem', color: '#fff' }}>R</span>
            </div>
            <span style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: '1rem', color: 'var(--lp-hdr-fg)', letterSpacing: '-0.02em' }}>{APP_NAME}</span>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'color-mix(in srgb, var(--lp-hdr-fg) 45%, transparent)', lineHeight: 1.7, maxWidth: '260px' }}>
            Graph-aware, self-hosted, MIT licensed AI code review.
          </p>
          <a href={APP_GITHUB_URL} target="_blank" rel="noopener noreferrer" className="lp-mono" style={{ display: 'inline-flex', marginTop: '16px', fontSize: '0.65rem', color: 'color-mix(in srgb, var(--lp-hdr-fg) 50%, transparent)', textDecoration: 'none', border: '1px solid color-mix(in srgb, var(--lp-hdr-fg) 12%, transparent)', padding: '4px 10px' }}>
            $ git clone
          </a>
        </div>

        {Object.entries(footerLinks).map(([title, links]) => (
          <div key={title}>
            <div className="footer-col-label lp-mono">{title}</div>
            {links.map((l) => (
              <a key={l.label} href={l.href} className="footer-link lp-mono">{l.label}</a>
            ))}
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px 32px 20px', borderTop: '1px solid var(--lp-hdr-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="lp-mono" style={{ fontSize: '0.62rem', color: 'color-mix(in srgb, var(--lp-hdr-fg) 30%, transparent)' }}>
          © {new Date().getFullYear()} {APP_NAME}. MIT Licensed. Open Source.
        </span>
        <div style={{ display: 'flex', gap: '16px' }}>
          <a href="/privacy" className="footer-link lp-mono" style={{ marginBottom: 0, fontSize: '0.62rem' }}>Privacy</a>
          <a href="/terms" className="footer-link lp-mono" style={{ marginBottom: 0, fontSize: '0.62rem' }}>Terms</a>
        </div>
      </div>

      {/* Ticker */}
      <div style={{ borderTop: '1px solid var(--lp-hdr-border)', overflow: 'hidden' }}>
        <div
          className="animate-ticker-32"
          style={{ display: 'flex', width: 'max-content' }}
          onMouseEnter={e => (e.currentTarget.style.animationPlayState = 'paused')}
          onMouseLeave={e => (e.currentTarget.style.animationPlayState = 'running')}
        >
          {items.map((item, i) => (
            <span
              key={i}
              className="lp-mono"
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '11px 22px',
                fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--lp-hdr-fg) 38%, transparent)',
                borderRight: '1px solid color-mix(in srgb, var(--lp-hdr-fg) 8%, transparent)',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: 'var(--lp-accent)', fontSize: '0.4rem' }}>◆</span>
              {item}
            </span>
          ))}
        </div>
      </div>
    </footer>
  )
}
