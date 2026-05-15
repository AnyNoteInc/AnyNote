'use client'

import { useSearchParams } from 'next/navigation'

import type { BoardData } from '../types'
import { TaskDetailModal } from './task-detail-modal'

interface TaskDetailContainerProps {
  pageId: string
  board: BoardData
}

export function TaskDetailContainer({ pageId, board }: TaskDetailContainerProps) {
  const taskId = useSearchParams()?.get('taskId')
  if (!taskId) return null
  const task = board.tasks.find((t) => t.id === taskId)
  if (!task) return null
  return <TaskDetailModal pageId={pageId} task={task} members={board.members} />
}
