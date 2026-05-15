'use client'

import { useEffect, useState } from 'react'
import {
  Box,
  Checkbox,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import type { BoardData, BoardTaskData } from '../types'

interface TaskFormProps {
  pageId: string
  task: BoardTaskData
  members: BoardData['members']
}

export function TaskForm({ pageId, task, members }: TaskFormProps) {
  const utils = trpc.useUtils()
  const updateTask = trpc.kanban.task.update.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const setAssignees = trpc.kanban.task.setAssignees.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const [title, setTitle] = useState(task.title)
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task.assignees.map((a) => a.user.id))
  const [dueDate, setDueDate] = useState<string>(
    task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '',
  )

  useEffect(() => {
    setTitle(task.title)
    setAssigneeIds(task.assignees.map((a) => a.user.id))
    setDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '')
  }, [task.id, task.title, task.assignees, task.dueDate])

  return (
    <Stack spacing={2}>
      <TextField
        label="Название"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== task.title) updateTask.mutate({ pageId, id: task.id, title })
        }}
        fullWidth
      />

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
          renderValue={(selected) => {
            const sel = selected as string[]
            return members
              .filter((m) => sel.includes(m.user.id))
              .map(
                (m) =>
                  `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email,
              )
              .join(', ')
          }}
          fullWidth
          size="small"
        >
          {members.map((m) => (
            <MenuItem key={m.user.id} value={m.user.id}>
              <Checkbox checked={assigneeIds.includes(m.user.id)} />
              <ListItemText
                primary={
                  `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email
                }
              />
            </MenuItem>
          ))}
        </Select>
      </Box>

      <TextField
        label="Срок"
        type="date"
        value={dueDate}
        InputLabelProps={{ shrink: true }}
        onChange={(e) => setDueDate(e.target.value)}
        onBlur={() => {
          const newValue = dueDate ? new Date(dueDate) : null
          updateTask.mutate({ pageId, id: task.id, dueDate: newValue })
        }}
      />
    </Stack>
  )
}
