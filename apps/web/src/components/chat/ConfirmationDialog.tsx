'use client'

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@repo/ui/components'

export type PendingConfirmation = {
  confirmationId: string
  tool: string
  summary: string
  argsPreview: unknown
}

export function ConfirmationDialog(props: {
  pending: PendingConfirmation | null
  onResolve: (confirmationId: string, action: 'allow' | 'deny') => void
}) {
  const { pending, onResolve } = props
  return (
    <Dialog
      open={pending !== null}
      onClose={() => pending && onResolve(pending.confirmationId, 'deny')}
    >
      <DialogTitle>Подтвердить действие</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{pending?.summary}</Typography>
        <Typography variant="caption" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>
          {'Инструмент: '}
          <code>{pending?.tool}</code>
          {'\n\n'}
          {'Аргументы: '}
          <code>{JSON.stringify(pending?.argsPreview, null, 2)}</code>
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => pending && onResolve(pending.confirmationId, 'deny')}>
          Отклонить
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={() => pending && onResolve(pending.confirmationId, 'allow')}
        >
          Разрешить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
