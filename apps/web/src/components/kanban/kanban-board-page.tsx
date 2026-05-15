'use client'

import { Box, CircularProgress, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { KanbanToolbar } from './kanban-toolbar'
import { BoardView } from './views/board-view'
import { TaskDetailContainer } from './task/task-detail-container'
import { useKanbanEvents } from './realtime/use-kanban-events'

interface KanbanBoardPageProps {
  pageId: string
  workspaceId: string
}

export function KanbanBoardPage({ pageId, workspaceId }: KanbanBoardPageProps) {
  const { data, isLoading, error } = trpc.kanban.board.getBoard.useQuery({ pageId })

  useKanbanEvents({ pageId })

  if (isLoading) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}
      >
        <CircularProgress />
      </Box>
    )
  }
  if (error || !data) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">
          Не удалось загрузить доску: {error?.message ?? 'неизвестная ошибка'}
        </Typography>
      </Box>
    )
  }

  return (
    <Stack sx={{ height: '100vh', overflow: 'hidden' }}>
      <KanbanToolbar pageId={pageId} workspaceId={workspaceId} />
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <BoardView pageId={pageId} board={data} />
      </Box>
      <TaskDetailContainer pageId={pageId} board={data} />
    </Stack>
  )
}
