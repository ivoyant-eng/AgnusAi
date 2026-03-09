import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

const AGENT_LABELS: Record<string, string> = {
  security: 'Security',
  correctness: 'Correctness',
  performance: 'Performance',
  style_maintainability: 'Style & Maintainability',
  ticket_compliance: 'Ticket Compliance',
  blast_radius: 'Blast Radius',
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 365 days', days: 365 },
]

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function TokenUsage() {
  const today = new Date()
  const [from, setFrom] = useState(() => toDateStr(new Date(Date.now() - 30 * 86400_000)))
  const [to, setTo] = useState(() => toDateStr(today))

  const { data, isLoading } = useSWR(
    `/api/orgs/default/token-usage?from=${from}&to=${to}`,
    fetcher,
  )

  function applyPreset(days: number) {
    setFrom(toDateStr(new Date(Date.now() - days * 86400_000)))
    setTo(toDateStr(new Date()))
  }

  const totalTokens: number = data?.totalTokens ?? 0

  return (
    <div>
      <p className="label-meta mb-3" style={{ color: '#E85A1A' }}>// usage</p>
      <h1 className="text-[clamp(1.4rem,2.5vw,2rem)] font-bold leading-none tracking-tight text-foreground mb-8">
        Token Usage.
      </h1>

      <div className="border-t border-border pt-6 space-y-8">

        {/* Date range controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="label-meta">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={e => setFrom(e.target.value)}
              className="border border-border bg-background px-3 py-1.5 font-mono text-sm focus:outline-none focus:border-[#E85A1A]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="label-meta">To</label>
            <input
              type="date"
              value={to}
              min={from}
              max={toDateStr(today)}
              onChange={e => setTo(e.target.value)}
              className="border border-border bg-background px-3 py-1.5 font-mono text-sm focus:outline-none focus:border-[#E85A1A]"
            />
          </div>
          <div className="flex items-center gap-2 ml-2">
            {PRESETS.map(p => (
              <button
                key={p.days}
                onClick={() => applyPreset(p.days)}
                className="label-meta px-3 py-1.5 border border-border hover:border-[#E85A1A] hover:text-foreground transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grand total */}
        <div className="flex items-baseline gap-3">
          <span className="text-[clamp(2rem,5vw,3.5rem)] font-bold leading-none tracking-tight">
            {isLoading ? '—' : fmtTokens(totalTokens)}
          </span>
          <span className="label-meta text-muted-foreground">total tokens</span>
        </div>

        {/* By agent */}
        {data?.byAgent?.length > 0 && (
          <div>
            <p className="label-meta mb-3">By Agent</p>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Total Tokens</TableHead>
                      <TableHead className="text-right">Avg / Run</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byAgent.map((a: any) => (
                      <TableRow key={a.role}>
                        <TableCell className="font-mono text-sm">
                          {AGENT_LABELS[a.role] ?? a.role}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{a.runs}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtTokens(a.totalTokens)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtTokens(a.avgTokens)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {/* By repo */}
        {data?.byRepo?.length > 0 && (
          <div>
            <p className="label-meta mb-3">By Repository</p>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Repository</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Total Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byRepo.map((r: any) => (
                      <TableRow key={r.repoId}>
                        <TableCell className="font-mono text-sm truncate max-w-xs">
                          {r.repoUrl.replace('https://github.com/', '').replace('https://dev.azure.com/', '')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{r.runs}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtTokens(r.totalTokens)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Daily sparkline table */}
        {data?.daily?.length > 0 && (
          <div>
            <p className="label-meta mb-3">Daily Breakdown</p>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.daily.map((d: any) => (
                      <TableRow key={d.date}>
                        <TableCell className="font-mono text-sm">{fmtDate(d.date)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{d.runs}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtTokens(d.totalTokens)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {!isLoading && totalTokens === 0 && (
          <p className="text-sm text-muted-foreground">
            No token usage data in the selected date range.
          </p>
        )}
      </div>
    </div>
  )
}
