'use client'

import { useMemo, useRef } from 'react'
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
  readonly editable?: boolean
}

const COLUMN_COLORS: Record<BoardData['columns'][number]['kind'], { bg: string; selected: string }> = {
  ACTIVE: { bg: '#3b82f6', selected: '#2563eb' },
  DONE: { bg: '#22c55e', selected: '#16a34a' },
  CANCELLED: { bg: '#9ca3af', selected: '#6b7280' },
}

function toDate(value: Date | string | null | undefined, fallback: Date): Date {
  if (!value) return fallback
  if (value instanceof Date) return value
  return new Date(value)
}

export function GanttView({ pageId, board, visibleTasks, editable = true }: GanttViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()
  const updateTask = trpc.kanban.task.update.useMutation({
    onError: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const justDraggedRef = useRef(false)

  const ganttTasks = useMemo<GanttTask[]>(() => {
    const today = new Date()
    return visibleTasks
      .filter((t) => t.startDate || t.dueDate)
      .map((t) => {
        const start = toDate(t.startDate, toDate(t.dueDate, today))
        const end = toDate(t.dueDate, toDate(t.startDate, today))
        const col = board.columns.find((c) => c.id === t.columnId)
        const palette = COLUMN_COLORS[col?.kind ?? 'ACTIVE']
        return {
          id: t.id,
          name: t.title,
          start: start <= end ? start : end,
          end: start <= end ? end : start,
          type: 'task' as const,
          progress: 0,
          dependencies: t.parentId ? [t.parentId] : undefined,
          isDisabled: false,
          styles: {
            backgroundColor: palette.bg,
            backgroundSelectedColor: palette.selected,
            progressColor: palette.selected,
            progressSelectedColor: palette.selected,
          },
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
        listCellWidth=""
        columnWidth={56}
        locale="ru"
        onDateChange={
          editable
            ? (task) => {
                justDraggedRef.current = true
                updateTask.mutate({
                  pageId,
                  id: task.id,
                  startDate: task.start,
                  dueDate: task.end,
                })
              }
            : undefined
        }
        onClick={(task) => {
          if (justDraggedRef.current) {
            justDraggedRef.current = false
            return
          }
          openDetail(task.id)
        }}
      />
    </Box>
  )
}
