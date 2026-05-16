'use client'

import { useMemo, useState } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { AddIcon, Box, Button, Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SprintCreateDialog } from '../sprint/sprint-create-dialog'
import { SprintSection } from './sprint-section'
import { positionBetween } from '../lib/positions'
import type { BoardData, BoardTaskData } from '../types'

const BACKLOG_DROPPABLE = 'backlog'
const SPRINT_PREFIX = 'sprint:'

interface TableViewProps {
  readonly pageId: string
  readonly board: BoardData
  readonly visibleTasks: BoardTaskData[]
}

function sectionKey(droppableId: string): string | null {
  return droppableId === BACKLOG_DROPPABLE ? null : droppableId.replace(SPRINT_PREFIX, '')
}

function tasksSortKey(t: BoardTaskData): number {
  return t.sprintPosition ?? t.position
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
      list.sort((a, b) => tasksSortKey(a) - tasksSortKey(b))
    }
    return bySprint
  }, [visibleTasks, board.sprints])

  const setData = utils.kanban.board.getBoard.setData as (
    input: { pageId: string },
    updater: (prev: BoardData | undefined) => BoardData | undefined,
  ) => void

  function patchTaskOptimistic(taskId: string, patch: Partial<BoardTaskData>) {
    setData({ pageId }, (current) => {
      if (!current) return current
      return {
        ...current,
        tasks: current.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      }
    })
  }

  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const sourceId = result.source.droppableId
    const destId = result.destination.droppableId
    if (sourceId === destId && result.source.index === result.destination.index) return

    const targetSprintId = sectionKey(destId)
    const destList = grouped.get(targetSprintId) ?? []
    const filtered = destList.filter((t) => t.id !== result.draggableId)
    const before = filtered[result.destination.index - 1] ?? null
    const after = filtered[result.destination.index] ?? null
    const newSprintPosition = positionBetween(
      before ? tasksSortKey(before) : null,
      after ? tasksSortKey(after) : null,
    )

    patchTaskOptimistic(result.draggableId, {
      sprintId: targetSprintId,
      sprintPosition: newSprintPosition,
    })

    await updateTask.mutateAsync({
      pageId,
      id: result.draggableId,
      sprintId: targetSprintId,
      sprintPosition: newSprintPosition,
    })
  }

  function removeFromSprint(taskId: string) {
    patchTaskOptimistic(taskId, { sprintId: null, sprintPosition: null })
    updateTask.mutate({ pageId, id: taskId, sprintId: null, sprintPosition: null })
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
            kind="sprint"
            pageId={pageId}
            sprint={sprint}
            allSprints={board.sprints}
            columns={board.columns}
            allTasks={board.tasks}
            tasks={grouped.get(sprint.id) ?? []}
            members={board.members}
            droppableId={`${SPRINT_PREFIX}${sprint.id}`}
            onRemoveTaskFromSprint={removeFromSprint}
          />
        ))}
        <SprintSection
          kind="backlog"
          droppableId={BACKLOG_DROPPABLE}
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
