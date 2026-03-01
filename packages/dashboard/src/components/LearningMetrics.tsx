import { FeedbackChart } from '@/components/FeedbackChart'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

type FeedbackMetrics = {
  series: Array<{ date: string; accepted: number; rejected: number }>
  totals: { accepted: number; rejected: number; total: number; acceptanceRate: number | null }
}

export function LearningMetrics({ metrics }: { metrics: FeedbackMetrics | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Learning Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        {metrics ? (
          <FeedbackChart series={metrics.series} totals={metrics.totals} />
        ) : (
          <div className="py-12 text-center">
            <p className="label-meta text-muted-foreground">Loading…</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
