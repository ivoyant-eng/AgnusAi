import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type Depth = 'fast' | 'standard' | 'deep'

const DEPTH_OPTIONS = [
  { key: 'fast' as Depth, label: 'Fast', hops: '1-hop traversal', embeddings: 'No embeddings', desc: 'Direct callers only. Lowest latency, minimal token usage.' },
  { key: 'standard' as Depth, label: 'Standard', hops: '2-hop traversal', embeddings: 'No embeddings', desc: 'Direct and transitive callers. Best balance of context vs. cost.', recommended: true },
  { key: 'deep' as Depth, label: 'Deep', hops: '2-hop traversal', embeddings: 'Semantic search', desc: 'Adds vector-similar symbols for cross-cutting concern detection.' },
]

const TOKEN_ROWS = [
  { label: 'Graph hops', fast: '1', standard: '2', deep: '2' },
  { label: 'Embedding search', fast: '—', standard: '—', deep: '✓' },
  { label: 'Extra tokens', fast: '~200', standard: '~600', deep: '~1 200' },
  { label: 'Latency added', fast: '<1ms', standard: '<2ms', deep: '~150ms' },
]

export function ReviewDepth() {
  const [depth, setDepth] = useState<Depth>('standard')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings', { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ reviewDepth: Depth }> : null)
      .then(d => { if (d?.reviewDepth) setDepth(d.reviewDepth) })
      .catch(() => {})
  }, [])

  async function save() {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reviewDepth: depth }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <p className="label-meta mb-3" style={{ color: '#E85A1A' }}>// review-depth</p>
      <h1 className="text-[clamp(1.4rem,2.5vw,2rem)] font-bold leading-none tracking-tight text-foreground mb-8">
        Review Depth.
      </h1>

      <div className="border-t border-border mb-8">
        {DEPTH_OPTIONS.map((opt, i) => {
          const isSelected = depth === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => setDepth(opt.key)}
              className={cn('w-full flex items-start gap-8 border-b border-border py-5 text-left transition-colors hover:bg-muted/20', isSelected && 'bg-muted/30')}
            >
              <span className={cn('num-display w-8 shrink-0 pt-0.5', isSelected && 'text-[#E85A1A]')}>
                {isSelected ? <Check className="h-4 w-4 text-[#E85A1A]" /> : String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-semibold text-base">{opt.label}</span>
                  {opt.recommended && <Badge variant="default" className="text-[10px] py-0">Recommended</Badge>}
                </div>
                <p className="label-meta">{opt.hops} · {opt.embeddings}</p>
                <p className="text-sm text-muted-foreground mt-2 font-mono">{opt.desc}</p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="border border-border mb-8">
        <div className="grid grid-cols-4 border-b border-border">
          {['', 'Fast', 'Standard', 'Deep'].map(h => (
            <div key={h} className={cn('px-4 py-3 label-meta', !h && 'border-r border-border')}>{h}</div>
          ))}
        </div>
        {TOKEN_ROWS.map(row => (
          <div key={row.label} className="grid grid-cols-4 border-b border-border last:border-0">
            <div className="px-4 py-3 label-meta border-r border-border">{row.label}</div>
            {(['fast', 'standard', 'deep'] as Depth[]).map(d => (
              <div key={d} className={cn('px-4 py-3 font-mono text-sm', depth === d ? 'bg-muted/30 text-foreground' : 'text-muted-foreground')}>
                {row[d]}
              </div>
            ))}
          </div>
        ))}
      </div>

      <Button size="lg" onClick={save} disabled={saved}>
        {saved ? '✓ Saved' : 'Save Settings'}
      </Button>
    </div>
  )
}
