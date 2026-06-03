'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  Box,
  CloseIcon,
  Dialog,
  IconButton,
  MenuItem,
  Select,
  Stack,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardData, BoardTaskData } from '../types'
import { TaskForm } from './task-form'
import { TaskSidePanel } from './task-side-panel'

interface TaskDetailModalProps {
  readonly pageId: string
  readonly task: BoardTaskData
  readonly board: BoardData
  readonly editable?: boolean
  readonly canComment?: boolean
}

export function TaskDetailModal({
  pageId,
  task,
  board,
  editable = true,
  canComment = true,
}: TaskDetailModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()
  const moveTask = trpc.kanban.task.move.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const orderedColumns = [...board.columns].sort((a, b) => a.position - b.position)

  function changeStatus(targetColumnId: string) {
    if (targetColumnId === task.columnId) return
    moveTask.mutate({ pageId, id: task.id, targetColumnId, beforeId: null, afterId: null })
  }

  function close() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('taskId')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : globalThis.location.pathname)
  }

  return (
    <Dialog
      open
      onClose={close}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: { xs: '95vw', md: '90vw', lg: '85vw' },
          maxWidth: 1400,
          height: { xs: '95vh', md: '88vh' },
          borderRadius: 2,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: 48,
        }}
      >
        <Select
          size="small"
          value={task.columnId}
          onChange={(e) => changeStatus(e.target.value)}
          disabled={!editable}
          sx={{ flex: '0 0 auto', minWidth: 180 }}
        >
          {orderedColumns.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: c.color ?? 'text.disabled' }} />
                <span>{c.title}</span>
              </Stack>
            </MenuItem>
          ))}
        </Select>
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={close} aria-label="Закрыть" size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{ flex: 1, minHeight: 0 }}
      >
        <Box
          sx={{
            flex: { xs: 'none', md: 2 },
            minWidth: 0,
            overflowY: 'auto',
            p: { xs: 2, md: 4 },
            pr: { md: 4 },
          }}
        >
          <TaskForm
            key={task.id}
            pageId={pageId}
            task={task}
            board={board}
            currentUserId={board.currentUserId}
            editable={editable}
          />
        </Box>
        <Box
          sx={{
            flex: { xs: 'none', md: 1 },
            minWidth: { md: 360 },
            borderLeft: { md: 1 },
            borderTop: { xs: 1, md: 0 },
            borderColor: { xs: 'divider', md: 'divider' },
            bgcolor: 'background.default',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <TaskSidePanel
            pageId={pageId}
            taskId={task.id}
            currentUserId={board.currentUserId}
            board={board}
            canComment={canComment}
          />
        </Box>
      </Stack>
    </Dialog>
  )
}
