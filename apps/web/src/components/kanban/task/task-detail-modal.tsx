'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  CloseIcon,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
} from '@repo/ui/components'

import type { BoardData, BoardTaskData } from '../types'
import { TaskForm } from './task-form'

interface TaskDetailModalProps {
  readonly pageId: string
  readonly task: BoardTaskData
  readonly board: BoardData
}

export function TaskDetailModal({ pageId, task, board }: TaskDetailModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function close() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('taskId')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : globalThis.location.pathname)
  }

  return (
    <Dialog open onClose={close} fullWidth maxWidth="md">
      <DialogTitle
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Stack>Задача</Stack>
        <IconButton onClick={close}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <TaskForm
          pageId={pageId}
          task={task}
          board={board}
          currentUserId={board.currentUserId}
        />
      </DialogContent>
    </Dialog>
  )
}
