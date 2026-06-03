'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
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
import { resolveAddSprintId } from './lib/resolve-add-sprint'
import { SelectionProvider } from './selection/selection-context'
import type { BoardData } from './types'

interface KanbanBoardPageProps {
  readonly pageId: string
  readonly editable?: boolean
  readonly canComment?: boolean
}

export function KanbanBoardPage({
  pageId,
  editable = true,
  canComment = true,
}: KanbanBoardPageProps) {
  const searchParams = useSearchParams()
  const { data, isLoading, error } = trpc.kanban.board.getBoard.useQuery({ pageId })

  const board = data as BoardData | undefined
  const selectedTaskId = searchParams.get('taskId')
  const isTaskDetailOpen = Boolean(
    selectedTaskId && board?.tasks.some((task) => task.id === selectedTaskId),
  )
  const hasActiveSprint = useMemo(
    () => board?.sprints?.some((s) => s.status === 'ACTIVE') ?? false,
    [board?.sprints],
  )
  const filtersBag = useKanbanFilters({
    defaultSprint: hasActiveSprint ? 'current' : 'all',
  })

  useKanbanEvents({ pageId })
  const visibleTasks = useMemo(() => {
    if (!board) return []
    return applyFilters(board.tasks, filtersBag.filters, {
      columns: board.columns,
      sprints: board.sprints,
    })
  }, [board, filtersBag.filters])
  const tableViewTasks = useMemo(() => {
    if (!board) return []
    return applyFilters(
      board.tasks,
      { ...filtersBag.filters, sprint: 'all', hideTerminalColumns: false },
      { columns: board.columns, sprints: board.sprints },
    )
  }, [board, filtersBag.filters])

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
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

  const addSprintId = resolveAddSprintId(filtersBag.filters.sprint, board.sprints)

  return (
    <SelectionProvider>
      <Stack sx={{ height: '100%', minHeight: 0, overflow: 'hidden', bgcolor: 'background.paper' }}>
        <KanbanToolbar pageId={pageId} filtersBag={filtersBag} board={board} editable={editable} />
        <Box sx={{ flex: 1, overflow: 'auto', p: 2, bgcolor: 'background.paper' }}>
          {!isTaskDetailOpen && (
            <>
              {filtersBag.view === 'board' && (
                <BoardView
                  pageId={pageId}
                  board={board}
                  visibleTasks={visibleTasks}
                  editable={editable}
                  addSprintId={addSprintId}
                />
              )}
              {filtersBag.view === 'table' && (
                <TableView
                  pageId={pageId}
                  board={board}
                  visibleTasks={tableViewTasks}
                  editable={editable}
                />
              )}
              {filtersBag.view === 'gantt' && (
                <GanttView
                  pageId={pageId}
                  board={board}
                  visibleTasks={visibleTasks}
                  editable={editable}
                />
              )}
            </>
          )}
        </Box>
        <TaskDetailContainer
          pageId={pageId}
          board={board}
          editable={editable}
          canComment={canComment}
        />
      </Stack>
    </SelectionProvider>
  )
}
