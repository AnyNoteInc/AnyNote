import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { getPlanDisplayName } from '@/components/billing/plan-labels'

type Row = {
  id: string
  status: string
  startedAt: Date
  currentPeriodEnd: Date | null
  canceledAt: Date | null
  amountPaid: number | null
  currency: string | null
  paymentProvider: string | null
  plan: { name: string; slug: string }
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null || amount === 0) return '—'
  const major = amount / 100
  return `${major.toLocaleString('ru-RU')} ${currency ?? ''}`
}

function formatPeriod(started: Date, end: Date | null, canceled: Date | null): string {
  const s = new Date(started).toLocaleDateString('ru-RU')
  const endish = canceled ?? end
  const e = endish ? new Date(endish).toLocaleDateString('ru-RU') : '—'
  return `${s} → ${e}`
}

export function SubscriptionHistoryTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Typography color="text.secondary">История пуста</Typography>
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Тариф</TableCell>
            <TableCell>Период</TableCell>
            <TableCell>Сумма</TableCell>
            <TableCell>Статус</TableCell>
            <TableCell>Оплачен через</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{getPlanDisplayName(r.plan)}</TableCell>
              <TableCell>{formatPeriod(r.startedAt, r.currentPeriodEnd, r.canceledAt)}</TableCell>
              <TableCell>{formatAmount(r.amountPaid, r.currency)}</TableCell>
              <TableCell>{r.status}</TableCell>
              <TableCell>{r.paymentProvider ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}
