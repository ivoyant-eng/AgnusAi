import { useState } from 'react'
import { Info, X } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

type AgentRow = {
  role: string
  runs: number
  avgDurationMs: number
  totalComments: number
  requestChangesCount: number
  errorCount: number
  totalTokens?: number | null
}

const AGENT_META: Record<string, { label: string; description: string }> = {
  security: {
    label: 'Security',
    description: 'Finds exploitable vulnerabilities, auth/authz gaps, unsafe data handling, and secrets exposure.',
  },
  correctness: {
    label: 'Correctness',
    description: 'Catches logic errors, race conditions, null/edge-case handling, and behavior regressions.',
  },
  performance: {
    label: 'Performance',
    description: 'Spots algorithmic complexity issues, redundant I/O, N+1 patterns, and hot-path inefficiencies.',
  },
  style_maintainability: {
    label: 'Style & Maintainability',
    description: 'Reviews code complexity and readability that could lead to future defects. Avoids cosmetic nits.',
  },
  ticket_compliance: {
    label: 'Ticket Compliance',
    description: 'Checks whether the implementation matches the linked ticket intent and acceptance criteria.',
  },
  blast_radius: {
    label: 'Blast Radius',
    description: 'Assesses change impact on dependent callers/modules and flags missing adaptations.',
  },
}

function AgentLabel({ role }: { role: string }) {
  const [open, setOpen] = useState(false)
  const meta = AGENT_META[role] ?? { label: role, description: '' }

  return (
    <span className="inline-flex items-center gap-1.5 relative">
      <span className="font-mono text-sm">{meta.label}</span>
      {meta.description && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Info about ${meta.label} agent`}
        >
          <Info className="h-3 w-3" />
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-6 z-10 w-64 border border-border bg-background p-3 shadow-md text-xs text-muted-foreground">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="label-meta text-foreground">{meta.label}</span>
            <button onClick={() => setOpen(false)} className="shrink-0 hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
          {meta.description}
        </div>
      )}
    </span>
  )
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function AgentTelemetry({ agents }: { agents: AgentRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Telemetry</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {agents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Runs</TableHead>
                <TableHead className="text-right">Avg ms</TableHead>
                <TableHead className="text-right">Comments</TableHead>
                <TableHead className="text-right">Req Changes</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map(a => (
                <TableRow key={a.role}>
                  <TableCell><AgentLabel role={a.role} /></TableCell>
                  <TableCell className="text-right font-mono text-sm">{a.runs}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{a.avgDurationMs.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{a.totalComments}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{a.requestChangesCount}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtTokens(a.totalTokens)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{a.errorCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="py-8 text-center">
            <p className="label-meta text-muted-foreground">No agent telemetry yet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
