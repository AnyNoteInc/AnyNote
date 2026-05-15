'use client'

import { Droppable } from '@hello-pangea/dnd'
import { Box, Paper, Stack, Typography } from '@repo/ui/components'

import type { BoardColumnWithTasks, BoardData } from '../types'
import { BoardCard } from './board-card'

interface BoardColumnProps {
  readonly pageId: string
  readonly column: BoardColumnWithTasks
  readonly board: BoardData
}

export function BoardColumn({ pageId, column, board }: BoardColumnProps) {
  return (
    <Paper
      variant="outlined"
      sx={{ width: 320, flexShrink: 0, p: 1.5, bgcolor: 'background.default' }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">{column.title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {column.tasks.length}
        </Typography>
      </Stack>
      <Droppable droppableId={column.id}>
        {(provided) => (
          <Box ref={provided.innerRef} {...provided.droppableProps} sx={{ minHeight: 40 }}>
            {column.tasks.map((task, index) => (
              <BoardCard
                key={task.id}
                pageId={pageId}
                task={task}
                index={index}
                board={board}
              />
            ))}
            {provided.placeholder}
          </Box>
        )}
      </Droppable>
    </Paper>
  )
}
