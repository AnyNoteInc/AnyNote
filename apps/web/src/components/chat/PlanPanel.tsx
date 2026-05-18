'use client'

import { Box, Stack, Typography, Chip } from '@repo/ui/components'

export type PlanStepView = {
  id: string
  title: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  position: number
}

const STATUS_LABEL: Record<
  PlanStepView['status'],
  { label: string; color: 'default' | 'info' | 'success' | 'error' }
> = {
  pending: { label: 'ждёт', color: 'default' },
  running: { label: 'выполняется', color: 'info' },
  done: { label: 'готово', color: 'success' },
  failed: { label: 'ошибка', color: 'error' },
  skipped: { label: 'пропущено', color: 'default' },
}

export function PlanPanel({ steps }: Readonly<{ steps: PlanStepView[] }>) {
  if (steps.length === 0) return null
  const sorted = [...steps].sort((a, b) => a.position - b.position)
  return (
    <Box sx={{ p: 2, borderLeft: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        План
      </Typography>
      <Stack spacing={1}>
        {sorted.map((s) => (
          <Box key={s.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Chip
              size="small"
              label={STATUS_LABEL[s.status].label}
              color={STATUS_LABEL[s.status].color}
            />
            <Typography variant="body2">
              {s.position + 1}. {s.title}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
