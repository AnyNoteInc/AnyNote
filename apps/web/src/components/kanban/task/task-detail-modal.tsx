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
  pageId: string
  task: BoardTaskData
  members: BoardData['members']
}

export function TaskDetailModal({ pageId, task, members }: TaskDetailModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function close() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('taskId')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : window.location.pathname)
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
        <TaskForm pageId={pageId} task={task} members={members} />
      </DialogContent>
    </Dialog>
  )
}
