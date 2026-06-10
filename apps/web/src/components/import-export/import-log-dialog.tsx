'use client'

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@repo/ui/components'

import type { JobRow } from './job-presentation'

type Props = {
  open: boolean
  onClose: () => void
  job: JobRow
}

export function ImportLogDialog({ open, onClose, job }: Props) {
  const warnings = job.warnings ?? []
  // The list is capped server-side; warningsCount is the uncapped total.
  const hiddenCount = job.warningsCount - warnings.length

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="import-log-dialog">
      <DialogTitle>{job.kind === 'export' ? 'Журнал экспорта' : 'Журнал импорта'}</DialogTitle>
      <DialogContent>
        {warnings.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Предупреждений нет.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {warnings.map((w, i) => (
              <Typography key={`${i}-${w}`} variant="body2">
                {w}
              </Typography>
            ))}
            {hiddenCount > 0 ? (
              <Typography variant="caption" color="text.secondary">
                …и ещё {hiddenCount} — полный список в скачиваемом журнале.
              </Typography>
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {job.hasReport ? (
          <Button
            component="a"
            href={`/api/jobs/import/${job.id}/report`}
            data-testid="download-report"
          >
            Скачать журнал
          </Button>
        ) : null}
        <Button variant="text" onClick={onClose}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  )
}
