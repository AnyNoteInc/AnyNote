'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import { Box, Paper, Stack, Typography } from '@repo/ui/components'

import type { BoardData, BoardTaskData } from '../types'

interface SprintSectionProps {
  droppableId: string
  title: string
  subtitle?: string
  tasks: BoardTaskData[]
  members: BoardData['members']
}

function memberFor(members: BoardData['members'], id: string) {
  return members.find((m) => m.user.id === id)
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
  function open(taskId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('taskId', taskId)
    router.replace(`?${params.toString()}`)
  }

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
      <Droppable droppableId={droppableId}>
        {(provided) => (
          <Box ref={provided.innerRef} {...provided.droppableProps} sx={{ minHeight: 32 }}>
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(p) => (
                  <Stack
                    ref={p.innerRef}
                    {...p.draggableProps}
                    {...p.dragHandleProps}
                    onClick={() => open(task.id)}
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
                    {task.assignees.length > 0 ? (
                      <Stack direction="row" spacing={-0.5}>
                        {task.assignees.slice(0, 3).map((a) => {
                          const m = memberFor(members, a.userId)
                          const initial = (
                            m?.user.firstName?.[0] ??
                            m?.user.email[0] ??
                            '?'
                          ).toUpperCase()
                          return (
                            <Box
                              key={a.userId}
                              sx={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                bgcolor: 'primary.main',
                                color: 'primary.contrastText',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 11,
                                border: 2,
                                borderColor: 'background.paper',
                              }}
                            >
                              {initial}
                            </Box>
                          )
                        })}
                      </Stack>
                    ) : null}
                    {task.dueDate ? (
                      <Typography variant="caption" color="text.secondary">
                        {new Date(task.dueDate).toLocaleDateString('ru-RU')}
                      </Typography>
                    ) : null}
                  </Stack>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </Box>
        )}
      </Droppable>
    </Paper>
  )
}
