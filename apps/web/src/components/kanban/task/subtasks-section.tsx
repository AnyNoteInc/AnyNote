'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Box, LinearProgress, Stack, Typography } from '@repo/ui/components'

import type { BoardData, BoardTaskData } from '../types'
import { subtaskProgress } from '../lib/hierarchy'
import { columnStatusColor } from '../lib/column-colors'

interface SubtasksSectionProps {
  readonly subtasks: BoardTaskData[]
  readonly board: BoardData
}

export function SubtasksSection({ subtasks, board }: SubtasksSectionProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const columnById = useMemo(() => new Map(board.columns.map((c) => [c.id, c])), [board.columns])
  const progress = useMemo(() => subtaskProgress(subtasks, columnById), [subtasks, columnById])

  if (subtasks.length === 0) return null

  function openChild(taskId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('taskId', taskId)
    router.replace(`?${params.toString()}`)
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          Подзадачи
        </Typography>
        <Typography variant="caption" color="text.secondary">
          выполнено {progress.done} из {progress.total}
        </Typography>
      </Stack>

      <LinearProgress
        variant="determinate"
        value={progress.ratio * 100}
        sx={{ mb: 1.5, height: 6, borderRadius: 3 }}
      />

      <Stack spacing={0.25}>
        {subtasks.map((child) => {
          const column = columnById.get(child.columnId)
          return (
            <Stack
              key={child.id}
              direction="row"
              alignItems="center"
              spacing={1}
              onClick={() => openChild(child.id)}
              sx={{
                py: 0.75,
                px: 1,
                borderRadius: 1,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: columnStatusColor(column),
                  flexShrink: 0,
                }}
              />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {child.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {column?.title ?? ''}
              </Typography>
            </Stack>
          )
        })}
      </Stack>
    </Box>
  )
}
