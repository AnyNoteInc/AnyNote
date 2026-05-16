'use client'

import { useMemo } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { KanbanToolbar } from './kanban-toolbar'
import { BoardView } from './views/board-view'
import { TableView } from './views/table-view'
import { GanttView } from './views/gantt-view'
import { TaskDetailContainer } from './task/task-detail-container'
import { useKanbanEvents } from './realtime/use-kanban-events'
import { useKanbanFilters } from './use-kanban-filters'
import { applyFilters } from './filters/apply-filters'
import type { BoardData } from './types'

interface KanbanBoardPageProps {
  readonly pageId: string
}

export function KanbanBoardPage({ pageId }: KanbanBoardPageProps) {
  const { data, isLoading, error } = trpc.kanban.board.getBoard.useQuery({ pageId })
  const filtersBag = useKanbanFilters()

  useKanbanEvents({ pageId })

  const board = data as BoardData | undefined
  const visibleTasks = useMemo(() => {
    if (!board) return []
    return applyFilters(board.tasks, filtersBag.filters, {
      columns: board.columns,
      sprints: board.sprints,
    })
  }, [board, filtersBag.filters])

  if (isLoading) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}
      >
        <CircularProgress />
      </Box>
    )
  }
  if (error || !board) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">
          Не удалось загрузить доску: {error?.message ?? 'неизвестная ошибка'}
        </Typography>
      </Box>
    )
  }

  return (
    <Stack sx={{ height: '100%', minHeight: 0, overflow: 'hidden', bgcolor: 'background.paper' }}>
      <KanbanToolbar pageId={pageId} filtersBag={filtersBag} board={board} />
      <Box sx={{ flex: 1, overflow: 'auto', p: 2, bgcolor: 'background.paper' }}>
        {filtersBag.view === 'board' && (
          <BoardView pageId={pageId} board={board} visibleTasks={visibleTasks} />
        )}
        {filtersBag.view === 'table' && (
          <TableView pageId={pageId} board={board} visibleTasks={visibleTasks} />
        )}
        {filtersBag.view === 'gantt' && (
          <GanttView pageId={pageId} board={board} visibleTasks={visibleTasks} />
        )}
      </Box>
      <TaskDetailContainer pageId={pageId} board={board} />
    </Stack>
  )
}
