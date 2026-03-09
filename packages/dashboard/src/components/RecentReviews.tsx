import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

type ReviewRow = {
  id: string
  prNumber: number
  verdict: 'approve' | 'request_changes' | 'comment'
  commentCount: number
  accepted: number
  rejected: number
  createdAt: string
}

const VERDICT_LABEL: Record<string, string> = {
  approve: 'Approved',
  request_changes: 'Changes Requested',
  comment: 'Comment',
}

const VERDICT_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  approve: 'default',
  request_changes: 'secondary',
  comment: 'outline',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function RecentReviews({ reviews }: { reviews: ReviewRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Reviews</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {reviews.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PR</TableHead>
                <TableHead className="text-right">Comments</TableHead>
                <TableHead className="text-right">Accepted / Rejected</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map(r => (
                <TableRow key={r.id}>
                  <TableCell>#{r.prNumber}</TableCell>
                  <TableCell className="text-right">{r.commentCount}</TableCell>
                  <TableCell className="text-right">{r.accepted}/{r.rejected}</TableCell>
                  <TableCell>
                    <Badge variant={VERDICT_VARIANT[r.verdict] ?? 'outline'}>
                      {VERDICT_LABEL[r.verdict] ?? r.verdict}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right label-meta">{formatDate(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="py-8 text-center">
            <p className="label-meta text-muted-foreground">No reviews found.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
