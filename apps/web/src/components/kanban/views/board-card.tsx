'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Draggable } from '@hello-pangea/dnd'
import { Box, Card, Stack, Typography } from '@repo/ui/components'

import type { BoardTaskData } from '../types'

interface BoardCardProps {
  task: BoardTaskData
  index: number
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
            <Stack direction="row" spacing={-0.5} sx={{ mt: 0.5 }}>
              {task.assignees.slice(0, 3).map((a) => (
                <Box
                  key={a.user.id}
                  sx={{
                    width: 24,
                    height: 24,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    border: 2,
                    borderColor: 'background.paper',
                  }}
                >
                  {(a.user.firstName?.[0] ?? a.user.email[0] ?? '?').toUpperCase()}
                </Box>
              ))}
            </Stack>
          ) : null}
        </Card>
      )}
    </Draggable>
  )
}
