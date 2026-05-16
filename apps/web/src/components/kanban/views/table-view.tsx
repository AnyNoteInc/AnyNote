'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import {
  AddIcon,
  Box,
  Button,
  Checkbox,
  Chip,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SprintCreateDialog } from '../sprint/sprint-create-dialog'
import { sprintStatusLabel } from '../sprint/sprint-status-label'
import { SprintSection } from './sprint-section'
import { positionBetween } from '../lib/positions'
import type { BoardData, BoardTaskData } from '../types'
import {
  DEFAULT_VISIBLE_SPRINT_STATUSES,
  getTableBacklogTasks,
  getTableSprintTasks,
  getTableSprintStatusOptions,
  visibleSprints,
} from './table-view-model'

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
  const setAssignees = trpc.kanban.task.setAssignees.useMutation({
    onError: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const softDeleteTask = trpc.kanban.task.softDelete.useMutation({
    onError: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const createTask = trpc.kanban.task.create.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [taskDraftSprintId, setTaskDraftSprintId] = useState<string | null | undefined>(
    undefined,
  )
  const [taskDraftTitle, setTaskDraftTitle] = useState('')
  const openTaskDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [statusAnchorEl, setStatusAnchorEl] = useState<HTMLElement | null>(null)
  const [selectedSprintStatuses, setSelectedSprintStatuses] = useState<string[]>([
    ...DEFAULT_VISIBLE_SPRINT_STATUSES,
  ])

  const statusOptions = useMemo(() => getTableSprintStatusOptions(), [])
  const shownSprints = useMemo(
    () => visibleSprints(board.sprints, selectedSprintStatuses),
    [board.sprints, selectedSprintStatuses],
  )
  const statusFilterLabel =
    selectedSprintStatuses.length === 0
      ? 'Спринты: ничего'
      : `Спринты: ${selectedSprintStatuses.map(sprintStatusLabel).join(', ')}`

  useEffect(
    () => () => {
      if (openTaskDraftTimerRef.current) {
        clearTimeout(openTaskDraftTimerRef.current)
      }
    },
    [],
  )

  const grouped = useMemo(() => {
    const bySprint = new Map<string | null, BoardTaskData[]>()
    bySprint.set(null, getTableBacklogTasks(visibleTasks, board.columns))
    for (const sprint of board.sprints) {
      bySprint.set(sprint.id, getTableSprintTasks(visibleTasks, sprint))
    }
    for (const list of bySprint.values()) {
      list.sort((a, b) => tasksSortKey(a) - tasksSortKey(b))
    }
    return bySprint
  }, [visibleTasks, board.columns, board.sprints])

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

  function removeTaskOptimistic(taskId: string) {
    setData({ pageId }, (current) => {
      if (!current) return current
      return {
        ...current,
        tasks: current.tasks.filter((task) => task.id !== taskId),
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

  function assignTaskToMe(taskId: string) {
    const task = board.tasks.find((candidate) => candidate.id === taskId)
    if (!task || task.assignees.some((assignee) => assignee.userId === board.currentUserId)) {
      return
    }

    const currentMember = board.members.find((member) => member.user.id === board.currentUserId)
    const nextUserIds = [...task.assignees.map((assignee) => assignee.userId), board.currentUserId]

    if (currentMember) {
      patchTaskOptimistic(taskId, {
        assignees: [
          ...task.assignees,
          { userId: board.currentUserId, user: currentMember.user },
        ],
      })
    }

    setAssignees.mutate({ pageId, id: taskId, userIds: nextUserIds })
  }

  function deleteTask(taskId: string) {
    removeTaskOptimistic(taskId)
    softDeleteTask.mutate({ pageId, id: taskId })
  }

  function startTaskDraft(sprintId: string | null) {
    if (openTaskDraftTimerRef.current) {
      clearTimeout(openTaskDraftTimerRef.current)
    }

    setTaskDraftSprintId(undefined)
    openTaskDraftTimerRef.current = setTimeout(() => {
      setTaskDraftTitle('')
      setTaskDraftSprintId(sprintId)
      openTaskDraftTimerRef.current = null
    }, 0)
  }

  function cancelTaskDraft() {
    setTaskDraftTitle('')
    setTaskDraftSprintId(undefined)
  }

  function commitTaskDraft() {
    const title = taskDraftTitle.trim()
    if (!title) {
      cancelTaskDraft()
      return
    }

    const sprintId = taskDraftSprintId
    setTaskDraftTitle('')
    setTaskDraftSprintId(undefined)
    createTask.mutate({ pageId, title, ...(sprintId ? { sprintId } : {}) })
  }

  function toggleSprintStatus(status: string) {
    setSelectedSprintStatuses((current) =>
      current.includes(status)
        ? current.filter((candidate) => candidate !== status)
        : [...current, status],
    )
  }

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Box>
          <Chip
            label={statusFilterLabel}
            size="small"
            variant="outlined"
            onClick={(event) => setStatusAnchorEl(event.currentTarget)}
            onDelete={
              selectedSprintStatuses.length === DEFAULT_VISIBLE_SPRINT_STATUSES.length &&
              DEFAULT_VISIBLE_SPRINT_STATUSES.every((status) =>
                selectedSprintStatuses.includes(status),
              )
                ? undefined
                : () => setSelectedSprintStatuses([...DEFAULT_VISIBLE_SPRINT_STATUSES])
            }
          />
          <Menu
            anchorEl={statusAnchorEl}
            open={Boolean(statusAnchorEl)}
            onClose={() => setStatusAnchorEl(null)}
          >
            {statusOptions.map((status) => (
              <MenuItem key={status} onClick={() => toggleSprintStatus(status)}>
                <Checkbox checked={selectedSprintStatuses.includes(status)} />
                <ListItemText primary={sprintStatusLabel(status)} />
              </MenuItem>
            ))}
          </Menu>
        </Box>
        <Button startIcon={<AddIcon />} size="small" onClick={() => setCreateOpen(true)}>
          Новый спринт
        </Button>
      </Stack>

      <DragDropContext onDragEnd={handleDragEnd}>
        {shownSprints.map((sprint) => (
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
            currentUserId={board.currentUserId}
            droppableId={`${SPRINT_PREFIX}${sprint.id}`}
            onStartCreateTask={() => startTaskDraft(sprint.id)}
            createTaskDraft={
              taskDraftSprintId === sprint.id
                ? {
                    title: taskDraftTitle,
                    disabled: createTask.isPending,
                    onTitleChange: setTaskDraftTitle,
                    onCommit: commitTaskDraft,
                    onCancel: cancelTaskDraft,
                  }
                : undefined
            }
            onAssignTaskToMe={assignTaskToMe}
            onRemoveTaskFromSprint={removeFromSprint}
            onDeleteTask={deleteTask}
          />
        ))}
        <SprintSection
          kind="backlog"
          droppableId={BACKLOG_DROPPABLE}
          tasks={grouped.get(null) ?? []}
          members={board.members}
          currentUserId={board.currentUserId}
          onStartCreateTask={() => startTaskDraft(null)}
          createTaskDraft={
            taskDraftSprintId === null
              ? {
                  title: taskDraftTitle,
                  disabled: createTask.isPending,
                  onTitleChange: setTaskDraftTitle,
                  onCommit: commitTaskDraft,
                  onCancel: cancelTaskDraft,
                }
              : undefined
          }
          onAssignTaskToMe={assignTaskToMe}
          onDeleteTask={deleteTask}
        />
      </DragDropContext>

      <SprintCreateDialog pageId={pageId} open={createOpen} onClose={() => setCreateOpen(false)} />
    </Box>
  )
}
