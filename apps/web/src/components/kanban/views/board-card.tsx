'use client'

import { useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Draggable } from '@hello-pangea/dnd'
import {
  Box,
  Card,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  MoreVertIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardData, BoardTaskData } from '../types'
import { AssigneeAvatars } from '../components/assignee-avatars'

interface BoardCardProps {
  readonly pageId: string
  readonly task: BoardTaskData
  readonly index: number
  readonly board: BoardData
}

export function BoardCard({ pageId, task, index, board }: BoardCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()
  const setAssignees = trpc.kanban.task.setAssignees.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const softDelete = trpc.kanban.task.softDelete.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  function openDetail() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('taskId', task.id)
    router.replace(`?${params.toString()}`)
  }

  function openMenu(e: MouseEvent<HTMLElement>) {
    e.stopPropagation()
    setMenuAnchor(e.currentTarget)
  }
  function closeMenu() {
    setMenuAnchor(null)
  }

  const isAssignedToMe = task.assignees.some((a) => a.userId === board.currentUserId)

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          sx={{
            mb: 1,
            border: 1,
            borderColor: 'divider',
            boxShadow: snapshot.isDragging ? 4 : 0,
            position: 'relative',
          }}
        >
          <Stack direction="row" alignItems="flex-start">
            <Box
              {...provided.dragHandleProps}
              onClick={openDetail}
              sx={{
                flex: 1,
                p: 1.25,
                pr: 0.5,
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {task.title}
              </Typography>
              {task.assignees.length > 0 || task.dueDate ? (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
                  {task.assignees.length > 0 ? (
                    <AssigneeAvatars assignees={task.assignees} />
                  ) : null}
                  {task.dueDate ? (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                      {new Date(task.dueDate).toLocaleDateString('ru-RU')}
                    </Typography>
                  ) : null}
                </Stack>
              ) : null}
            </Box>
            <IconButton
              size="small"
              aria-label="Меню задачи"
              onClick={openMenu}
              sx={{ mt: 0.5, mr: 0.5 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={closeMenu}
            onClick={(e) => e.stopPropagation()}
          >
            {isAssignedToMe ? null : (
              <MenuItem
                onClick={() => {
                  closeMenu()
                  const next = Array.from(
                    new Set([...task.assignees.map((a) => a.userId), board.currentUserId]),
                  )
                  setAssignees.mutate({ pageId, id: task.id, userIds: next })
                }}
              >
                <ListItemText primary="Назначить на меня" />
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                closeMenu()
                softDelete.mutate({ pageId, id: task.id })
              }}
            >
              <ListItemText primary="Удалить" />
            </MenuItem>
          </Menu>
        </Card>
      )}
    </Draggable>
  )
}
