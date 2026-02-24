interface FeedbackChartProps {
  series: Array<{ date: string; accepted: number; rejected: number }>
  totals: { accepted: number; rejected: number; total: number; acceptanceRate: number | null }
}

const BAR_MAX_H = 120
const BAR_W = 32
const BAR_GAP = 20
const CHART_BOTTOM = 150
const LABEL_Y = CHART_BOTTOM + 16

function formatWeek(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function FeedbackChart({ series, totals }: FeedbackChartProps) {
  if (series.length === 0) {
    return (
      <div className="border border-border py-12 text-center">
        <p className="label-meta text-muted-foreground">
          No feedback yet — click 👍/👎 on PR review comments to start
        </p>
      </div>
    )
  }

  const maxTotal = Math.max(...series.map(d => d.accepted + d.rejected), 1)

  const totalBars = series.length
  const svgW = Math.max(600, totalBars * (BAR_W + BAR_GAP) + BAR_GAP * 2)

  const pct = totals.acceptanceRate !== null ? Math.round(totals.acceptanceRate * 100) : null

  return (
    <div>
      {/* Headline stat */}
      <p className="font-mono text-xs text-muted-foreground mb-4">
        {pct !== null
          ? `${pct}% acceptance rate · ${totals.total} rating${totals.total !== 1 ? 's' : ''}`
          : `${totals.total} rating${totals.total !== 1 ? 's' : ''}`}
      </p>

      {/* Legend */}
      <div className="flex items-center gap-6 mb-4">
        <span className="flex items-center gap-1.5 label-meta">
          <span className="inline-block w-3 h-3" style={{ background: '#E85A1A' }} />
          Accepted
        </span>
        <span className="flex items-center gap-1.5 label-meta">
          <span className="inline-block w-3 h-3" style={{ background: '#3D3D3B' }} />
          Rejected
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgW} 180`}
          width="100%"
          style={{ minWidth: Math.min(svgW, 600) }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {series.map((d, i) => {
            const x = BAR_GAP + i * (BAR_W + BAR_GAP)
            const totalH = ((d.accepted + d.rejected) / maxTotal) * BAR_MAX_H
            const acceptedH = totalH > 0 ? (d.accepted / (d.accepted + d.rejected)) * totalH : 0
            const rejectedH = totalH - acceptedH

            return (
              <g key={d.date}>
                {/* Accepted bar (orange, bottom) */}
                {acceptedH > 0 && (
                  <rect
                    x={x}
                    y={CHART_BOTTOM - acceptedH}
                    width={BAR_W}
                    height={acceptedH}
                    fill="#E85A1A"
                  />
                )}
                {/* Rejected bar (dark, top) */}
                {rejectedH > 0 && (
                  <rect
                    x={x}
                    y={CHART_BOTTOM - totalH}
                    width={BAR_W}
                    height={rejectedH}
                    fill="#3D3D3B"
                  />
                )}
                {/* X-axis label */}
                <text
                  x={x + BAR_W / 2}
                  y={LABEL_Y}
                  textAnchor="middle"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  fill="#8A8880"
                >
                  {formatWeek(d.date)}
                </text>
              </g>
            )
          })}

          {/* Baseline */}
          <line
            x1={0}
            y1={CHART_BOTTOM}
            x2={svgW}
            y2={CHART_BOTTOM}
            stroke="#B8B5AF"
            strokeWidth={1}
          />
        </svg>
      </div>
    </div>
  )
}
