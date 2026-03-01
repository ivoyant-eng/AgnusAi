import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

type PrecisionBucket = {
  bucket: string
  total: number
  accepted: number
  acceptanceRate: number | null
}

export function ConfidenceCalibration({ buckets }: { buckets: PrecisionBucket[] }) {
  if (!buckets.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confidence Calibration</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Confidence</TableHead>
              <TableHead className="text-right">Comments</TableHead>
              <TableHead className="text-right">Acceptance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buckets.map(b => (
              <TableRow key={b.bucket}>
                <TableCell>{b.bucket}</TableCell>
                <TableCell className="text-right">{b.total}</TableCell>
                <TableCell className="text-right">
                  {b.acceptanceRate !== null ? `${b.acceptanceRate}%` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
