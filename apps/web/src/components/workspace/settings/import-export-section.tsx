'use client'

import { useState } from 'react'

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  DeleteIcon,
  DownloadIcon,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { BulkExportDialog } from '@/components/import-export/bulk-export-dialog'
import { ImportWizardDialog } from '@/components/import-export/import-wizard-dialog'
import { describeJob, statusChip, type JobRow } from '@/components/import-export/job-presentation'
import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspaceId: string
}

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ImportExportSection({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const jobsQ = trpc.job.list.useQuery(
    { workspaceId },
    {
      refetchInterval: (query) => {
        const rows = query.state.data
        return rows?.some((j) => j.status === 'QUEUED' || j.status === 'PROCESSING') ? 2500 : false
      },
    },
  )

  const del = trpc.job.delete.useMutation({
    onSuccess: () => utils.job.list.invalidate({ workspaceId }),
  })

  // Over HTTP (no superjson) createdAt arrives as an ISO string even though the
  // server type says Date — JobRow types it string | Date.
  const rows: JobRow[] = jobsQ.data ?? []

  return (
    <SettingsCard
      title="Импорт и экспорт"
      description="Импортируйте Markdown/HTML-файлы и ZIP-архивы, экспортируйте страницы в ZIP. Задания выполняются в фоне; архив экспорта хранится 7 дней и доступен только вам."
    >
      <Stack direction="row" spacing={1}>
        <Button variant="contained" data-testid="open-import" onClick={() => setImportOpen(true)}>
          Импортировать
        </Button>
        <Button variant="outlined" data-testid="open-export" onClick={() => setExportOpen(true)}>
          Экспортировать
        </Button>
      </Stack>

      {jobsQ.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          Пока нет заданий.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Задание</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Создано</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((j) => {
              const chip = statusChip(j)
              const chipEl = <Chip label={chip.label} color={chip.color} size="small" />
              return (
                <TableRow key={`${j.kind}-${j.id}`} data-testid="job-row">
                  <TableCell>
                    <Typography variant="body2" noWrap>
                      {describeJob(j)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {j.status === 'FAILED' ? (
                      <Tooltip title={j.error ?? ''}>{chipEl}</Tooltip>
                    ) : (
                      chipEl
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(j.createdAt)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {j.kind === 'export' && j.hasArtifact ? (
                        <IconButton
                          size="small"
                          component="a"
                          href={`/api/jobs/export/${j.id}/artifact`}
                          data-testid="job-download"
                          aria-label="Скачать архив"
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      ) : null}
                      <IconButton
                        size="small"
                        disabled={del.isPending}
                        onClick={() => del.mutate({ workspaceId, kind: j.kind, jobId: j.id })}
                        aria-label="Удалить задание"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <ImportWizardDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        workspaceId={workspaceId}
      />
      <BulkExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        workspaceId={workspaceId}
      />
    </SettingsCard>
  )
}
