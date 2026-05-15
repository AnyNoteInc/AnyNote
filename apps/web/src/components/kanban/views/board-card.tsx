'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Draggable } from '@hello-pangea/dnd'
import { Card, Typography } from '@repo/ui/components'

import type { BoardTaskData } from '../types'
import { AssigneeAvatars } from '../components/assignee-avatars'

interface BoardCardProps {
  readonly task: BoardTaskData
  readonly index: number
}

export function BoardCard({ task, index }: BoardCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function openDetail() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('taskId', task.id)
    router.replace(`?${params.toString()}`)
  }

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={openDetail}
          sx={{
            mb: 1,
            p: 1.25,
            cursor: 'pointer',
            boxShadow: snapshot.isDragging ? 4 : 0,
          }}
        >
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {task.title}
          </Typography>
          {task.dueDate ? (
            <Typography variant="caption" color="text.secondary">
              до {new Date(task.dueDate).toLocaleDateString('ru-RU')}
            </Typography>
          ) : null}
          {task.assignees.length > 0 ? (
            <div style={{ marginTop: 4 }}>
              <AssigneeAvatars assignees={task.assignees} />
            </div>
          ) : null}
        </Card>
      )}
    </Draggable>
  )
}
