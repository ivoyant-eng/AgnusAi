import { useEffect, useRef, useState } from 'react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface IndexStep {
  step: 'parsing' | 'embedding' | 'done' | 'error'
  file?: string
  progress?: number
  total?: number
  symbolCount?: number
  edgeCount?: number
  durationMs?: number
  message?: string
}

interface Props {
  repoId: string
  branch?: string
  onDone?: (stats: { symbolCount: number; edgeCount: number; durationMs: number }) => void
  onError?: (message: string) => void
}

const STEPS = [
  { key: 'parsing', label: '01', title: 'Parse', desc: 'Walking source files' },
  { key: 'embedding', label: '02', title: 'Embed', desc: 'Generating symbol vectors' },
  { key: 'done', label: '03', title: 'Ready', desc: 'Graph loaded into memory' },
]

export function SseProgressBar({ repoId, branch = 'main', onDone, onError }: Props) {
  const [current, setCurrent] = useState<IndexStep | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [pct, setPct] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(`/api/repos/${repoId}/index/status?branch=${encodeURIComponent(branch)}`)
    esRef.current = es

    es.onmessage = (e) => {
      const data: IndexStep = JSON.parse(e.data)
      setCurrent(data)

      if (data.step === 'parsing' && data.progress && data.total) {
        const p = Math.round((data.progress / data.total) * 80)
        setPct(p)
        if (data.file) {
          setLogs(prev => [...prev.slice(-4), data.file!])
        }
      } else if (data.step === 'embedding') {
        setPct(90)
      } else if (data.step === 'done') {
        setPct(100)
        es.close()
        onDone?.({
          symbolCount: data.symbolCount ?? 0,
          edgeCount: data.edgeCount ?? 0,
          durationMs: data.durationMs ?? 0,
        })
      } else if (data.step === 'error') {
        es.close()
        const msg = data.message ?? 'Indexing failed'
        setErrorMsg(msg)
        onError?.(msg)
      }
    }

    es.onerror = () => es.close()
    return () => es.close()
  }, [repoId, branch])

  const activeStep = current?.step ?? 'parsing'

  if (errorMsg) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 rounded-sm p-6 space-y-2">
        <p className="label-meta text-destructive">Indexing Failed</p>
        <p className="font-mono text-sm text-destructive">{errorMsg}</p>
        <p className="text-sm text-muted-foreground mt-2">
          Make sure <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">repoPath</code> is
          the absolute path to a local clone of the repository that is accessible inside the container
          (e.g. a path under <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">/tmp</code>
          which is mounted from the host).
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Steps list — TinyFish numbered timeline style */}
      <div className="border-t border-border">
        {STEPS.map((s, i) => {
          const stepKeys = ['parsing', 'embedding', 'done']
          const stepIdx = stepKeys.indexOf(s.key)
          const activeIdx = stepKeys.indexOf(activeStep)
          const isDone = stepIdx < activeIdx || activeStep === 'done'
          const isActive = s.key === activeStep && activeStep !== 'done'

          return (
            <div
              key={s.key}
              className={cn(
                'flex items-start gap-8 border-b border-border py-6 px-0 transition-colors',
                isActive && 'bg-muted/30',
              )}
            >
              <span className={cn('num-display w-8 shrink-0 pt-0.5', isDone && 'text-foreground')}>
                {isDone ? '✓' : s.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className={cn('font-medium text-base', isDone && 'line-through text-muted-foreground')}>
                  {s.title}
                </p>
                <p className="label-meta mt-1">{s.desc}</p>
                {isActive && current?.file && (
                  <p className="font-mono text-xs text-muted-foreground mt-2 truncate">
                    {current.file}
                  </p>
                )}
              </div>
              {isActive && current?.progress && current?.total && (
                <span className="num-display shrink-0">
                  {current.progress}/{current.total}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="label-meta">Progress</span>
          <span className="num-display">{pct}%</span>
        </div>
        <Progress value={pct} />
      </div>

      {/* Done stats */}
      {activeStep === 'done' && current && (
        <div className="grid grid-cols-3 border-t border-border pt-6">
          <StatCell label="Symbols" value={current.symbolCount?.toLocaleString() ?? '—'} />
          <StatCell label="Edges" value={current.edgeCount?.toLocaleString() ?? '—'} />
          <StatCell
            label="Duration"
            value={current.durationMs ? `${(current.durationMs / 1000).toFixed(1)}s` : '—'}
          />
        </div>
      )}
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-0 pr-8">
      <p className="label-meta">{label}</p>
      <p className="font-mono text-2xl font-semibold text-foreground mt-1">{value}</p>
    </div>
  )
}
