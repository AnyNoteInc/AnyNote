'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Draggable,
  Droppable,
  type DraggableProvided,
  type DroppableProvided,
} from '@hello-pangea/dnd'
import { Box, Paper, Stack, Typography } from '@repo/ui/components'

import type { BoardData, BoardTaskData } from '../types'
import { AssigneeAvatars } from '../components/assignee-avatars'

interface SprintSectionProps {
  readonly droppableId: string
  readonly title: string
  readonly subtitle?: string
  readonly tasks: BoardTaskData[]
  readonly members: BoardData['members']
}

interface TaskRowProps {
  readonly task: BoardTaskData
  readonly provided: DraggableProvided
  readonly memberLookup: (userId: string) => { firstName: string | null; email: string } | undefined
  readonly onOpen: (taskId: string) => void
}

function TaskRow({ task, provided, memberLookup, onOpen }: TaskRowProps) {
  return (
    <Stack
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onClick={() => onOpen(task.id)}
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        py: 1,
        px: 1.25,
        borderRadius: 1,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography variant="body2" sx={{ flex: 1 }}>
        {task.title}
      </Typography>
      <AssigneeAvatars assignees={task.assignees} memberLookup={memberLookup} size={22} />
      {task.dueDate ? (
        <Typography variant="caption" color="text.secondary">
          {new Date(task.dueDate).toLocaleDateString('ru-RU')}
        </Typography>
      ) : null}
    </Stack>
  )
}

export function SprintSection({
  droppableId,
  title,
  subtitle,
  tasks,
  members,
}: SprintSectionProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const open = useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('taskId', taskId)
      router.replace(`?${params.toString()}`)
    },
    [router, searchParams],
  )
  const memberLookup = useCallback(
    (userId: string) => {
      const m = members.find((x) => x.user.id === userId)
      return m ? { firstName: m.user.firstName, email: m.user.email } : undefined
    },
    [members],
  )

  const renderDroppable = (provided: DroppableProvided) => (
    <Box ref={provided.innerRef} {...provided.droppableProps} sx={{ minHeight: 32 }}>
      {tasks.map((task, index) => (
        <Draggable key={task.id} draggableId={task.id} index={index}>
          {(p) => (
            <TaskRow task={task} provided={p} memberLookup={memberLookup} onOpen={open} />
          )}
        </Draggable>
      ))}
      {provided.placeholder}
    </Box>
  )

  return (
    <Paper variant="outlined" sx={{ mb: 2, p: 1.5 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1">{title}</Typography>
        {subtitle ? (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {tasks.length}
        </Typography>
      </Stack>
      <Droppable droppableId={droppableId}>{renderDroppable}</Droppable>
    </Paper>
  )
}
