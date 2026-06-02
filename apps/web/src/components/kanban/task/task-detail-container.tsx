'use client'

import { useSearchParams } from 'next/navigation'

import type { BoardData } from '../types'
import { TaskDetailModal } from './task-detail-modal'

interface TaskDetailContainerProps {
  readonly pageId: string
  readonly board: BoardData
  readonly editable?: boolean
  readonly canComment?: boolean
}

export function TaskDetailContainer({
  pageId,
  board,
  editable = true,
  canComment = true,
}: TaskDetailContainerProps) {
  const taskId = useSearchParams()?.get('taskId')
  if (!taskId) return null
  const task = board.tasks.find((t) => t.id === taskId)
  if (!task) return null
  return (
    <TaskDetailModal
      pageId={pageId}
      task={task}
      board={board}
      editable={editable}
      canComment={canComment}
    />
  )
}
