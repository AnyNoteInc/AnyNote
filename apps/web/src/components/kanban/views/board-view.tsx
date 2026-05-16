'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import {
  AddIcon,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { BoardColumn } from './board-column'
import type { BoardData, BoardColumnWithTasks } from '../types'
import { positionBetween } from '../lib/positions'

interface BoardViewProps {
  readonly pageId: string
  readonly board: BoardData
  readonly visibleTasks: BoardData['tasks']
}

export function BoardView({ pageId, board, visibleTasks }: BoardViewProps) {
  const utils = trpc.useUtils()
  const moveTask = trpc.kanban.task.move.useMutation({
    onError: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const columnsWithTasks = useMemo<BoardColumnWithTasks[]>(() => {
    return board.columns.map((c) => ({
      ...c,
      tasks: visibleTasks
        .filter((t) => t.columnId === c.id)
        .sort((a, b) => a.position - b.position),
    }))
  }, [board.columns, visibleTasks])

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
          <BoardColumn key={column.id} pageId={pageId} column={column} board={board} />
        ))}
        <AddColumnForm pageId={pageId} />
      </Stack>
    </DragDropContext>
  )
}

interface AddColumnFormProps {
  readonly pageId: string
}

function AddColumnForm({ pageId }: AddColumnFormProps) {
  const utils = trpc.useUtils()
  const createColumn = trpc.kanban.column.create.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const skipBlurRef = useRef(false)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function open() {
    setTitle('')
    setEditing(true)
  }
  function close() {
    setEditing(false)
    setTitle('')
  }
  async function commit() {
    const trimmed = title.trim()
    if (!trimmed) {
      close()
      return
    }
    setTitle('')
    await createColumn.mutateAsync({ pageId, title: trimmed })
    inputRef.current?.focus()
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      skipBlurRef.current = true
      close()
    }
  }

  if (!editing) {
    return (
      <Box sx={{ width: 320, flexShrink: 0, alignSelf: 'flex-start' }}>
        <Button
          startIcon={<AddIcon fontSize="small" />}
          onClick={open}
          size="small"
          variant="outlined"
          color="inherit"
          disableRipple
          fullWidth
          sx={{
            justifyContent: 'flex-start',
            color: 'text.secondary',
            textTransform: 'none',
            borderColor: 'divider',
            borderStyle: 'dashed',
            py: 1.25,
            '&:hover': { bgcolor: 'action.hover', borderColor: 'divider' },
          }}
        >
          Добавить ещё одну колонку
        </Button>
      </Box>
    )
  }

  return (
    <Paper
      variant="outlined"
      sx={{ width: 320, flexShrink: 0, p: 1.5, bgcolor: 'background.default', alignSelf: 'flex-start' }}
    >
      <Stack spacing={1}>
        <TextField
          inputRef={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false
              return
            }
            void commit()
          }}
          placeholder="Введите название колонки…"
          size="small"
          fullWidth
          autoFocus
          sx={{ bgcolor: 'background.paper' }}
        />
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="contained"
            size="small"
            onMouseDown={(e) => {
              e.preventDefault()
              skipBlurRef.current = true
            }}
            onClick={() => void commit()}
            disabled={createColumn.isPending}
          >
            Добавить колонку
          </Button>
          <Button
            size="small"
            onMouseDown={(e) => {
              e.preventDefault()
              skipBlurRef.current = true
            }}
            onClick={close}
          >
            Отмена
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
