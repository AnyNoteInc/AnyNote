'use client'

import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type Props = {
  open: boolean
  periodEnd: Date | null
  onClose: () => void
}

export function CancelSubscriptionDialog({ open, periodEnd, onClose }: Props) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const cancel = trpc.subscription.cancel.useMutation({
    onSuccess: async () => {
      await utils.subscription.getCurrent.invalidate()
      onClose()
      router.refresh()
    },
  })
  const dateStr = periodEnd ? new Date(periodEnd).toLocaleDateString('ru-RU') : 'конца периода'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Отменить подписку?</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary">
          Подписка останется активной до {dateStr}, затем вы перейдете на Персональный без потери
          данных.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={cancel.isPending}>
          Не отменять
        </Button>
        <Button color="error" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          {cancel.isPending ? 'Отменяем...' : 'Отменить подписку'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
