'use client'

import { useMemo, useState } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { AddIcon, Box, Button, Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SprintCreateDialog } from '../sprint/sprint-create-dialog'
import { SprintSection } from './sprint-section'
import type { BoardData, BoardTaskData } from '../types'

const BACKLOG_DROPPABLE = 'backlog'
const SPRINT_PREFIX = 'sprint:'

interface TableViewProps {
  pageId: string
  board: BoardData
  visibleTasks: BoardTaskData[]
}

export function TableView({ pageId, board, visibleTasks }: TableViewProps) {
  const utils = trpc.useUtils()
  const updateTask = trpc.kanban.task.update.useMutation({
    onError: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const [createOpen, setCreateOpen] = useState(false)

  const grouped = useMemo(() => {
    const bySprint = new Map<string | null, BoardTaskData[]>()
    bySprint.set(null, [])
    for (const s of board.sprints) bySprint.set(s.id, [])
    for (const task of visibleTasks) {
      const key = task.sprintId ?? null
      const list = bySprint.get(key) ?? []
      list.push(task)
      bySprint.set(key, list)
    }
    for (const list of bySprint.values()) {
      list.sort((a, b) => a.position - b.position)
    }
    return bySprint
  }, [visibleTasks, board.sprints])

  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const sourceId = result.source.droppableId
    const destId = result.destination.droppableId
    if (sourceId === destId && result.source.index === result.destination.index) return

    const targetSprintId = destId === BACKLOG_DROPPABLE ? null : destId.replace(SPRINT_PREFIX, '')
    await updateTask.mutateAsync({
      pageId,
      id: result.draggableId,
      sprintId: targetSprintId,
    })
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button startIcon={<AddIcon />} size="small" onClick={() => setCreateOpen(true)}>
          Новый спринт
        </Button>
      </Stack>

      <DragDropContext onDragEnd={handleDragEnd}>
        {board.sprints.map((sprint) => (
          <SprintSection
            key={sprint.id}
            droppableId={`${SPRINT_PREFIX}${sprint.id}`}
            title={sprint.name}
            subtitle={sprint.status}
            tasks={grouped.get(sprint.id) ?? []}
            members={board.members}
          />
        ))}
        <SprintSection
          droppableId={BACKLOG_DROPPABLE}
          title="Беклог"
          tasks={grouped.get(null) ?? []}
          members={board.members}
        />
      </DragDropContext>

      <SprintCreateDialog
        pageId={pageId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </Box>
  )
}
