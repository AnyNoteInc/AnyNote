'use client'

import { useMemo } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { BoardColumn } from './board-column'
import type { BoardData, BoardColumnWithTasks } from '../types'
import { positionBetween } from '../lib/positions'

interface BoardViewProps {
  pageId: string
  board: BoardData
}

export function BoardView({ pageId, board }: BoardViewProps) {
  const utils = trpc.useUtils()
  const moveTask = trpc.kanban.task.move.useMutation({
    onError: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const columnsWithTasks = useMemo<BoardColumnWithTasks[]>(() => {
    return board.columns.map((c) => ({
      ...c,
      tasks: board.tasks
        .filter((t) => t.columnId === c.id)
        .sort((a, b) => a.position - b.position),
    }))
  }, [board])

  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const sourceColId = result.source.droppableId
    const destColId = result.destination.droppableId
    const taskId = result.draggableId
    if (sourceColId === destColId && result.source.index === result.destination.index) return

    const destCol = columnsWithTasks.find((c) => c.id === destColId)
    if (!destCol) return
    const destTasksWithoutMoved = destCol.tasks.filter((t) => t.id !== taskId)
    const before = destTasksWithoutMoved[result.destination.index - 1] ?? null
    const after = destTasksWithoutMoved[result.destination.index] ?? null
    const newPosition = positionBetween(before?.position ?? null, after?.position ?? null)

    const setData = utils.kanban.board.getBoard.setData as (
      input: { pageId: string },
      updater: (prev: BoardData | undefined) => BoardData | undefined,
    ) => void
    setData({ pageId }, (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId ? { ...t, columnId: destColId, position: newPosition } : t,
        ),
      }
    })

    await moveTask.mutateAsync({
      pageId,
      id: taskId,
      targetColumnId: destColId,
      beforeId: before?.id ?? null,
      afterId: after?.id ?? null,
    })
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Stack direction="row" spacing={2} sx={{ height: '100%', overflowX: 'auto', pb: 2 }}>
        {columnsWithTasks.map((column) => (
          <BoardColumn key={column.id} column={column} />
        ))}
      </Stack>
    </DragDropContext>
  )
}
