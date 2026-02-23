import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SseProgressBar } from '@/components/SseProgressBar'

interface IndexStats {
  symbolCount: number
  edgeCount: number
  durationMs: number
}

export default function Indexing() {
  const { repoId } = useParams<{ repoId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const branch = searchParams.get('branch') ?? 'main'
  const [stats, setStats] = useState<IndexStats | null>(null)

  if (!repoId) return null

  return (
    <div className="max-w-2xl">
      <p className="label-meta mb-4">Indexing Repository</p>

      <h1 className="text-[clamp(2.5rem,6vw,5rem)] font-bold leading-none tracking-tight text-foreground mb-4">
        Building the<br />Symbol Graph.
      </h1>

      <p className="text-muted-foreground font-mono text-sm mb-12">
        Tree-sitter is parsing your codebase and building a dependency graph.
        This only happens once — future indexing is incremental.
      </p>

      <SseProgressBar repoId={repoId} branch={branch} onDone={setStats} />

      {stats && (
        <div className="mt-12 pt-8 border-t border-border">
          <p className="label-meta mb-6">Indexing Complete</p>
          <p className="text-2xl font-semibold mb-8">
            {stats.symbolCount.toLocaleString()} symbols indexed
            in {(stats.durationMs / 1000).toFixed(1)}s.
          </p>
          <Button size="lg" onClick={() => navigate(`/app/ready/${repoId}`)} className="gap-3">
            Continue
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
