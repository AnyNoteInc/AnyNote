'use client'

import { useMemo, useRef } from 'react'
import { Gantt, type Task as GanttTask, ViewMode } from 'gantt-task-react'
import 'gantt-task-react/dist/index.css'
import { useRouter, useSearchParams } from 'next/navigation'
import { Box, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardData, BoardColumnRow, BoardTaskData } from '../types'
import { buildChildCountMap } from '../lib/hierarchy'
import { KIND_COLORS } from '../lib/column-colors'

interface GanttViewProps {
  readonly pageId: string
  readonly board: BoardData
  readonly visibleTasks: BoardTaskData[]
  readonly editable?: boolean
}

type BarPalette = { bg: string; selected: string }

// Bar fill per column kind. `normal.bg` reuses the shared KIND_COLORS status hue;
// `parent` is a saturated variant so parent bars stand out from their children.
// Adding a new kind forces filling both variants here in one place.
const KIND_BAR_PALETTES: Record<
  BoardColumnRow['kind'],
  { normal: BarPalette; parent: BarPalette }
> = {
  ACTIVE: {
    normal: { bg: KIND_COLORS.ACTIVE, selected: '#2563eb' },
    parent: { bg: '#1d4ed8', selected: '#1e40af' },
  },
  DONE: {
    normal: { bg: KIND_COLORS.DONE, selected: '#16a34a' },
    parent: { bg: '#15803d', selected: '#166534' },
  },
  CANCELLED: {
    normal: { bg: KIND_COLORS.CANCELLED, selected: '#6b7280' },
    parent: { bg: '#4b5563', selected: '#374151' },
  },
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

  // Parent-ness is derived from the full task list (not visibleTasks) so a task
  // counts as a parent even when its children are filtered out of the timeline —
  // matching the board/table/detail definition of "has at least one child".
  const childCountByParent = useMemo(() => buildChildCountMap(board.tasks), [board.tasks])
  const columnById = useMemo(() => new Map(board.columns.map((c) => [c.id, c])), [board.columns])

  const ganttTasks = useMemo<GanttTask[]>(() => {
    const today = new Date()
    return visibleTasks
      .filter((t) => t.startDate || t.dueDate)
      .map((t) => {
        const start = toDate(t.startDate, toDate(t.dueDate, today))
        const end = toDate(t.dueDate, toDate(t.startDate, today))
        const kind = columnById.get(t.columnId)?.kind ?? 'ACTIVE'
        const isParent = (childCountByParent.get(t.id) ?? 0) > 0
        const palette = KIND_BAR_PALETTES[kind][isParent ? 'parent' : 'normal']
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
  }, [visibleTasks, childCountByParent, columnById])

  if (ganttTasks.length === 0) {
    return (
      <Box sx={{ p: 4, color: 'text.secondary' }}>
        <Typography>Задайте даты у задач (начало или срок) — они появятся в Ганте.</Typography>
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
