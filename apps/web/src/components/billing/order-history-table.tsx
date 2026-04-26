import type { Order, Plan } from '@prisma/client'
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { getPlanDisplayName } from './plan-labels'

type Row = Order & { plan: Pick<Plan, 'name' | 'slug'> }

function formatAmount(amountKopecks: number, currency: string): string {
  return `${(amountKopecks / 100).toLocaleString('ru-RU')} ${currency === 'RUB' ? '₽' : currency}`
}

function formatPeriod(order: Row): string {
  return order.billingPeriod === 'MONTHLY' ? 'Месяц' : 'Год'
}

export function OrderHistoryTable({ orders }: { orders: Row[] }) {
  if (!orders.length) {
    return <Typography color="text.secondary">История платежей пуста.</Typography>
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, overflowX: 'auto' }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
        История платежей
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Дата</TableCell>
            <TableCell>Тариф</TableCell>
            <TableCell>Период</TableCell>
            <TableCell align="right">Сумма</TableCell>
            <TableCell>Статус</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>{new Date(order.createdAt).toLocaleDateString('ru-RU')}</TableCell>
              <TableCell>{getPlanDisplayName(order.plan)}</TableCell>
              <TableCell>{formatPeriod(order)}</TableCell>
              <TableCell align="right">
                {formatAmount(order.amountKopecks, order.currency)}
              </TableCell>
              <TableCell>{order.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  )
}
