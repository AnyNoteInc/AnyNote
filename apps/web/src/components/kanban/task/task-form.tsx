'use client'

import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Divider,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import type { BoardData, BoardTaskData } from '../types'
import { TaskComments } from './task-comments'
import { TaskActivityList } from './task-activity-list'

interface TaskFormProps {
  readonly pageId: string
  readonly task: BoardTaskData
  readonly board: BoardData
  readonly currentUserId: string
}

function memberLabel(m: BoardData['members'][number]) {
  return `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email
}

function readDescriptionText(value: unknown): string {
  if (value && typeof value === 'object' && 'text' in value) {
    const text = (value as { text: unknown }).text
    if (typeof text === 'string') return text
  }
  return typeof value === 'string' ? value : ''
}

export function TaskForm({ pageId, task, board, currentUserId }: TaskFormProps) {
  const utils = trpc.useUtils()
  const invalidateBoard = () => utils.kanban.board.getBoard.invalidate({ pageId })
  const updateTask = trpc.kanban.task.update.useMutation({ onSuccess: invalidateBoard })
  const setAssignees = trpc.kanban.task.setAssignees.useMutation({ onSuccess: invalidateBoard })
  const setLabels = trpc.kanban.task.setLabels.useMutation({ onSuccess: invalidateBoard })
  const archive = trpc.kanban.task.archive.useMutation({ onSuccess: invalidateBoard })
  const unarchive = trpc.kanban.task.unarchive.useMutation({ onSuccess: invalidateBoard })

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(readDescriptionText(task.description))
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task.assignees.map((a) => a.user.id))
  const [labelIds, setLabelIds] = useState<string[]>(task.labels.map((l) => l.labelId))
  const [typeId, setTypeId] = useState<string>(task.typeId ?? '')
  const [priorityId, setPriorityId] = useState<string>(task.priorityId ?? '')
  const [sprintId, setSprintId] = useState<string>(task.sprintId ?? '')
  const [parentId, setParentId] = useState<string>(task.parentId ?? '')
  const [dueDate, setDueDate] = useState<string>(
    task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '',
  )
  const [startDate, setStartDate] = useState<string>(
    task.startDate ? new Date(task.startDate).toISOString().slice(0, 10) : '',
  )

  useEffect(() => {
    setTitle(task.title)
    setDescription(readDescriptionText(task.description))
    setAssigneeIds(task.assignees.map((a) => a.user.id))
    setLabelIds(task.labels.map((l) => l.labelId))
    setTypeId(task.typeId ?? '')
    setPriorityId(task.priorityId ?? '')
    setSprintId(task.sprintId ?? '')
    setParentId(task.parentId ?? '')
    setDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '')
    setStartDate(task.startDate ? new Date(task.startDate).toISOString().slice(0, 10) : '')
  }, [task])

  const parentCandidates = board.tasks.filter((t) => t.id !== task.id)

  return (
    <Stack spacing={3}>
      <TextField
        label="Название"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== task.title) updateTask.mutate({ pageId, id: task.id, title })
        }}
        fullWidth
      />

      <TextField
        label="Описание"
        value={description}
        multiline
        minRows={3}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          const next = description
          const prev = readDescriptionText(task.description)
          if (next !== prev) {
            updateTask.mutate({
              pageId,
              id: task.id,
              description: next ? { text: next } : null,
            })
          }
        }}
        fullWidth
      />

      <Stack direction="row" spacing={2}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Тип
          </Typography>
          <Select
            size="small"
            fullWidth
            value={typeId}
            onChange={(e) => {
              const value = e.target.value
              setTypeId(value)
              updateTask.mutate({ pageId, id: task.id, typeId: value || null })
            }}
          >
            <MenuItem value="">—</MenuItem>
            {board.types.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.title}
              </MenuItem>
            ))}
          </Select>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Приоритет
          </Typography>
          <Select
            size="small"
            fullWidth
            value={priorityId}
            onChange={(e) => {
              const value = e.target.value
              setPriorityId(value)
              updateTask.mutate({ pageId, id: task.id, priorityId: value || null })
            }}
          >
            <MenuItem value="">—</MenuItem>
            {board.priorities.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.title}
              </MenuItem>
            ))}
          </Select>
        </Box>
      </Stack>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Исполнители
        </Typography>
        <Select
          multiple
          value={assigneeIds}
          onChange={(e) => {
            const value = Array.isArray(e.target.value) ? e.target.value : [e.target.value]
            setAssigneeIds(value)
            setAssignees.mutate({ pageId, id: task.id, userIds: value })
          }}
          renderValue={(selected) =>
            board.members
              .filter((m) => (selected as string[]).includes(m.user.id))
              .map(memberLabel)
              .join(', ')
          }
          fullWidth
          size="small"
        >
          {board.members.map((m) => (
            <MenuItem key={m.user.id} value={m.user.id}>
              <Checkbox checked={assigneeIds.includes(m.user.id)} />
              <ListItemText primary={memberLabel(m)} />
            </MenuItem>
          ))}
        </Select>
      </Box>

      {board.labels.length > 0 ? (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Метки
          </Typography>
          <Select
            multiple
            value={labelIds}
            onChange={(e) => {
              const value = Array.isArray(e.target.value) ? e.target.value : [e.target.value]
              setLabelIds(value)
              setLabels.mutate({ pageId, id: task.id, labelIds: value })
            }}
            renderValue={(selected) =>
              board.labels
                .filter((l) => (selected as string[]).includes(l.id))
                .map((l) => l.name)
                .join(', ')
            }
            fullWidth
            size="small"
          >
            {board.labels.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                <Checkbox checked={labelIds.includes(l.id)} />
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    bgcolor: l.color,
                    mr: 1,
                  }}
                />
                <ListItemText primary={l.name} />
              </MenuItem>
            ))}
          </Select>
        </Box>
      ) : null}

      <Stack direction="row" spacing={2}>
        <TextField
          label="Дата старта"
          type="date"
          fullWidth
          value={startDate}
          slotProps={{ inputLabel: { shrink: true } }}
          onChange={(e) => setStartDate(e.target.value)}
          onBlur={() =>
            updateTask.mutate({
              pageId,
              id: task.id,
              startDate: startDate ? new Date(startDate) : null,
            })
          }
        />
        <TextField
          label="Срок"
          type="date"
          fullWidth
          value={dueDate}
          slotProps={{ inputLabel: { shrink: true } }}
          onChange={(e) => setDueDate(e.target.value)}
          onBlur={() =>
            updateTask.mutate({
              pageId,
              id: task.id,
              dueDate: dueDate ? new Date(dueDate) : null,
            })
          }
        />
      </Stack>

      <Stack direction="row" spacing={2}>
        {board.sprints.length > 0 ? (
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              Спринт
            </Typography>
            <Select
              size="small"
              fullWidth
              value={sprintId}
              onChange={(e) => {
                const value = e.target.value
                setSprintId(value)
                updateTask.mutate({ pageId, id: task.id, sprintId: value || null })
              }}
            >
              <MenuItem value="">Беклог</MenuItem>
              {board.sprints.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
          </Box>
        ) : null}
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Зависит от
          </Typography>
          <Select
            size="small"
            fullWidth
            value={parentId}
            onChange={(e) => {
              const value = e.target.value
              setParentId(value)
              updateTask.mutate({ pageId, id: task.id, parentId: value || null })
            }}
          >
            <MenuItem value="">—</MenuItem>
            {parentCandidates.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.title}
              </MenuItem>
            ))}
          </Select>
        </Box>
      </Stack>

      <Stack direction="row" spacing={1}>
        {task.archived ? (
          <Button size="small" onClick={() => unarchive.mutate({ pageId, id: task.id })}>
            Из архива
          </Button>
        ) : (
          <Button size="small" onClick={() => archive.mutate({ pageId, id: task.id })}>
            В архив
          </Button>
        )}
      </Stack>

      <Divider />

      <TaskComments pageId={pageId} taskId={task.id} currentUserId={currentUserId} />

      <Divider />

      <TaskActivityList pageId={pageId} taskId={task.id} />
    </Stack>
  )
}
