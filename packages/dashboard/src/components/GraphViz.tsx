import { useEffect, useRef } from 'react'

// All SVG colors as explicit inline styles — avoids CSS cascade / SVG inheritance issues
// Colors tuned for dark background (graph panel uses --lp-hdr-bg = #1C1C1A)
const C = {
  accent:      '#E85A1A',                   // Orange
  accentFg:    '#FFFFFF',
  fg:          '#F5F4F0',                   // Off-white text on dark bg
  muted:       'rgba(245,244,240,0.35)',     // Muted light for dark bg
  cardBg:      'rgba(245,244,240,0.06)',     // Translucent for normal nodes
  nodeBorder:  'rgba(245,244,240,0.18)',     // Subtle border on dark bg
  affectedBg:  'rgba(232,90,26,0.18)',       // Orange tint for affected nodes
}

export function GraphViz() {
  const raf1 = useRef<number>(0)
  const raf2 = useRef<number>(0)
  const raf3 = useRef<number>(0)

  useEffect(() => {
    function show(id: string, delay: number) {
      setTimeout(() => {
        const el = document.getElementById(id)
        if (!el) return
        el.style.transition = 'opacity 0.4s ease'
        el.style.opacity = '1'
      }, delay)
    }

    function pulse(id: string, delay: number) {
      setTimeout(() => {
        const el = document.getElementById(id)
        if (!el) return
        let t = 0
        const step = () => {
          t += 0.025
          const r = 30 + Math.sin(t) * 7
          const op = 0.12 + Math.abs(Math.sin(t)) * 0.15
          el.setAttribute('r', String(r))
          el.style.opacity = String(op)
          const raf = requestAnimationFrame(step)
          if (id === 'p1') raf1.current = raf
          else if (id === 'p2') raf2.current = raf
          else if (id === 'p3') raf3.current = raf
        }
        step()
      }, delay)
    }

    show('n0', 200)
    show('e1', 550); show('e2', 750)
    show('n1', 900); show('n2', 1050)
    show('e3', 1300); show('e4', 1500); show('e5', 1700)
    show('n3', 1800); show('n4', 1950)
    pulse('p1', 950); pulse('p2', 1100); pulse('p3', 2000)

    return () => {
      cancelAnimationFrame(raf1.current)
      cancelAnimationFrame(raf2.current)
      cancelAnimationFrame(raf3.current)
    }
  }, [])

  const edgeStyle = { stroke: C.muted, fill: 'none', strokeWidth: 1.5 } as const
  const dashedStyle = { stroke: C.muted, fill: 'none', strokeWidth: 1, strokeDasharray: '4 3' } as const
  const labelStyle = { fontFamily: "'JetBrains Mono', monospace", fontSize: 10 } as const
  const subStyle   = { fontFamily: "'JetBrains Mono', monospace", fontSize: 8 } as const

  return (
    <div className="graph-panel">
      <div className="graph-tbar">
        <div className="tl-dots">
          <span className="tl tl-r" />
          <span className="tl tl-y" />
          <span className="tl tl-g" />
        </div>
        <span className="graph-fname">symbol-graph.ts · PR #142</span>
        <span className="graph-badge">⚡ analyzing</span>
      </div>

      {/* No inherited stroke on the SVG root */}
      <svg id="gsvg" viewBox="0 0 460 310" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arr" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" style={{ fill: C.muted }} />
          </marker>
          <marker id="arr-a" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" style={{ fill: C.accent }} />
          </marker>
        </defs>

        {/* edges */}
        <line style={edgeStyle} id="e1" x1="230" y1="73" x2="118" y2="163" markerEnd="url(#arr-a)" opacity={0} />
        <line style={edgeStyle} id="e2" x1="230" y1="73" x2="342" y2="163" markerEnd="url(#arr-a)" opacity={0} />
        <line style={edgeStyle} id="e3" x1="100" y1="200" x2="100" y2="258" markerEnd="url(#arr)" opacity={0} />
        <line style={edgeStyle} id="e4" x1="360" y1="200" x2="360" y2="258" markerEnd="url(#arr-a)" opacity={0} />
        <path style={dashedStyle} id="e5" d="M148,185 Q230,215 312,270" markerEnd="url(#arr)" opacity={0} />

        {/* pulse rings */}
        <circle id="p1" cx="100" cy="181" r={32} opacity={0} style={{ stroke: C.accent, fill: 'none', strokeWidth: 1.5 }} />
        <circle id="p2" cx="360" cy="181" r={32} opacity={0} style={{ stroke: C.accent, fill: 'none', strokeWidth: 1.5 }} />
        <circle id="p3" cx="360" cy="277" r={28} opacity={0} style={{ stroke: C.accent, fill: 'none', strokeWidth: 1.5 }} />

        {/* UserService — CHANGED */}
        <g id="n0" opacity={0} transform="translate(230,57)">
          <rect x="-72" y="-20" width="144" height="40" rx="3"
            style={{ fill: C.accent, stroke: C.accent }} />
          <text x="0" y="-4" textAnchor="middle"
            style={{ ...labelStyle, fill: C.accentFg, fontWeight: 500 }}>UserService</text>
          <text x="0" y="10" textAnchor="middle"
            style={{ ...subStyle, fill: C.accentFg, opacity: 0.8 }}>CHANGED</text>
        </g>

        {/* AuthService — affected */}
        <g id="n1" opacity={0} transform="translate(100,181)">
          <rect x="-60" y="-20" width="120" height="40" rx="3"
            style={{ fill: C.affectedBg, stroke: C.accent, strokeWidth: 1.5 }} />
          <text x="0" y="-4" textAnchor="middle"
            style={{ ...labelStyle, fill: C.fg }}>AuthService</text>
          <text x="0" y="10" textAnchor="middle"
            style={{ ...subStyle, fill: C.accent }}>⚠ affected</text>
        </g>

        {/* validateUser — affected */}
        <g id="n2" opacity={0} transform="translate(360,181)">
          <rect x="-64" y="-20" width="128" height="40" rx="3"
            style={{ fill: C.affectedBg, stroke: C.accent, strokeWidth: 1.5 }} />
          <text x="0" y="-4" textAnchor="middle"
            style={{ ...labelStyle, fill: C.fg }}>validateUser</text>
          <text x="0" y="10" textAnchor="middle"
            style={{ ...subStyle, fill: C.accent }}>⚠ affected</text>
        </g>

        {/* Database — normal */}
        <g id="n3" opacity={0} transform="translate(100,277)">
          <rect x="-52" y="-20" width="104" height="40" rx="3"
            style={{ fill: C.cardBg, stroke: C.nodeBorder, strokeWidth: 1 }} />
          <text x="0" y="-4" textAnchor="middle"
            style={{ ...labelStyle, fill: C.fg }}>Database</text>
          <text x="0" y="10" textAnchor="middle"
            style={{ ...subStyle, fill: C.muted }}>unchanged</text>
        </g>

        {/* JWT.sign — affected */}
        <g id="n4" opacity={0} transform="translate(360,277)">
          <rect x="-46" y="-20" width="92" height="40" rx="3"
            style={{ fill: C.affectedBg, stroke: C.accent, strokeWidth: 1.5 }} />
          <text x="0" y="-4" textAnchor="middle"
            style={{ ...labelStyle, fill: C.fg }}>JWT.sign</text>
          <text x="0" y="10" textAnchor="middle"
            style={{ ...subStyle, fill: C.accent }}>⚠ affected</text>
        </g>
      </svg>

      <div className="graph-foot">
        <span className="gstat">Blast radius: <span>4 fns</span></span>
        <span className="gstat">Depth: <span>2-hop</span></span>
        <span className="gstat">Symbols: <span>2,841</span></span>
      </div>
    </div>
  )
}
