'use client'

import { useMemo } from 'react'
import { Gantt, type Task as GanttTask, ViewMode } from 'gantt-task-react'
import 'gantt-task-react/dist/index.css'
import { useRouter, useSearchParams } from 'next/navigation'
import { Box, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardData, BoardTaskData } from '../types'

interface GanttViewProps {
  readonly pageId: string
  readonly board: BoardData
  readonly visibleTasks: BoardTaskData[]
}

function progressForColumn(
  columnId: string,
  columns: BoardData['columns'],
): number {
  const c = columns.find((col) => col.id === columnId)
  if (!c) return 0
  if (c.kind === 'DONE') return 100
  if (c.kind === 'CANCELLED') return 0
  return 50
}

function toDate(value: Date | string | null | undefined, fallback: Date): Date {
  if (!value) return fallback
  if (value instanceof Date) return value
  return new Date(value)
}

export function GanttView({ pageId, board, visibleTasks }: GanttViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()
  const updateTask = trpc.kanban.task.update.useMutation({
    onError: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const ganttTasks = useMemo<GanttTask[]>(() => {
    const today = new Date()
    return visibleTasks
      .filter((t) => t.startDate || t.dueDate)
      .map((t) => {
        const start = toDate(t.startDate, toDate(t.dueDate, today))
        const end = toDate(t.dueDate, toDate(t.startDate, today))
        return {
          id: t.id,
          name: t.title,
          start: start <= end ? start : end,
          end: start <= end ? end : start,
          type: 'task' as const,
          progress: progressForColumn(t.columnId, board.columns),
          dependencies: t.parentId ? [t.parentId] : undefined,
          isDisabled: false,
        }
      })
  }, [visibleTasks, board.columns])

  if (ganttTasks.length === 0) {
    return (
      <Box sx={{ p: 4, color: 'text.secondary' }}>
        <Typography>
          Задайте даты у задач (начало или срок) — они появятся в Ганте.
        </Typography>
      </Box>
    )
  }

  function openDetail(taskId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('taskId', taskId)
    router.replace(`?${params.toString()}`)
  }

  return (
    <Box sx={{ '.gantt-table': { fontFamily: 'inherit' } }}>
      <Gantt
        tasks={ganttTasks}
        viewMode={ViewMode.Week}
        listCellWidth="160px"
        columnWidth={56}
        locale="ru"
        onDateChange={(task) =>
          updateTask.mutate({
            pageId,
            id: task.id,
            startDate: task.start,
            dueDate: task.end,
          })
        }
        onClick={(task) => openDetail(task.id)}
      />
    </Box>
  )
}
