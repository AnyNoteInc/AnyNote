'use client'

import { useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Draggable } from '@hello-pangea/dnd'
import {
  Box,
  Card,
  Chip,
  FlagIcon,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  MoreVertIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import { readableTextColor } from '@repo/domain/kanban/colors.ts'

import { trpc } from '@/trpc/client'

import type { BoardData, BoardTaskData } from '../types'
import { AssigneeAvatars } from '../components/assignee-avatars'
import { isAssignedTo } from '../lib/assignees'
import { getBoardCardModel, type CardDateTone } from './board-card-model'

interface BoardCardProps {
  readonly pageId: string
  readonly task: BoardTaskData
  readonly index: number
  readonly board: BoardData
  readonly editable?: boolean
}

const DATE_BADGE_STYLES: Record<
  CardDateTone,
  { color: string; borderColor: string; backgroundColor: string }
> = {
  default: { color: '#64748B', borderColor: '#CBD5E1', backgroundColor: 'transparent' },
  soon: { color: '#B45309', borderColor: '#F59E0B', backgroundColor: '#FEF3C7' },
  overdue: { color: '#B91C1C', borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
}

export function BoardCard({ pageId, task, index, board, editable = true }: BoardCardProps) {
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

  const isAssignedToMe = isAssignedTo(task.assignees, board.currentUserId)
  const model = getBoardCardModel(task, board)
  const accentColor = model.priorityColor ?? 'transparent'
  const dateBadge = DATE_BADGE_STYLES[model.dateTone]

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={!editable}>
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
            overflow: 'hidden',
            transition: 'border-color 120ms ease, box-shadow 120ms ease',
            '&:hover': {
              borderColor: 'text.disabled',
              boxShadow: snapshot.isDragging ? 4 : 1,
            },
          }}
        >
          <Box
            aria-hidden
            sx={{ position: 'absolute', inset: '0 auto 0 0', width: 3, bgcolor: accentColor }}
          />
          <Stack direction="row" alignItems="flex-start">
            <Box
              {...provided.dragHandleProps}
              onClick={openDetail}
              sx={{
                flex: 1,
                p: 1.25,
                pl: model.priorityColor ? 1.5 : 1.25,
                pr: 0.5,
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              {model.type || model.priority ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={0.5}
                  sx={{ mb: 0.75, minWidth: 0, pr: 0.5 }}
                >
                  {model.type ? (
                    <Chip
                      size="small"
                      label={model.type.title}
                      sx={{
                        height: 20,
                        maxWidth: 92,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        color: 'text.secondary',
                        '& .MuiChip-label': {
                          px: 0.75,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        },
                      }}
                    />
                  ) : null}
                  {model.priority && model.priorityTone ? (
                    <Chip
                      size="small"
                      icon={<FlagIcon sx={{ color: `${accentColor} !important`, fontSize: 15 }} />}
                      label={model.priority.title}
                      sx={{
                        height: 20,
                        maxWidth: 116,
                        borderRadius: 1,
                        bgcolor: `${accentColor}1A`,
                        color: accentColor,
                        '& .MuiChip-label': {
                          pl: 0.25,
                          pr: 0.75,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        },
                      }}
                    />
                  ) : null}
                </Stack>
              ) : null}

              <Typography
                variant="body2"
                fontWeight={600}
                sx={{
                  mb: 0.75,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  overflowWrap: 'anywhere',
                }}
              >
                {task.title}
              </Typography>

              {/* Row 1: date (left) ─ spacer ─ avatars (right). The negative right
                  margin pulls right-aligned content back over the menu-button
                  column so it sits as close to the card edge as the date is on
                  the left. */}
              {task.assignees.length > 0 || model.dateLabel ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ mt: 0.25, minWidth: 0, mr: editable ? -3.5 : 0 }}
                >
                  {model.dateLabel ? (
                    <Box
                      component="span"
                      sx={{
                        px: 0.75, py: 0.125, border: 1, borderRadius: 1,
                        color: dateBadge.color, borderColor: dateBadge.borderColor,
                        bgcolor: dateBadge.backgroundColor, fontSize: 12, lineHeight: '18px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {model.dateLabel}
                    </Box>
                  ) : null}
                  <Box sx={{ flex: 1 }} />
                  {task.assignees.length > 0 ? <AssigneeAvatars assignees={task.assignees} /> : null}
                </Stack>
              ) : null}

              {/* Row 2: labels (right-aligned, pulled to the card edge like row 1) */}
              {model.visibleLabels.length > 0 ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="flex-end"
                  spacing={0.5}
                  sx={{ mt: 0.5, minWidth: 0, mr: editable ? -3.5 : 0 }}
                >
                  {model.visibleLabels.map((item) => (
                    <Chip
                      key={item.labelId}
                      size="small"
                      label={item.label.name}
                      sx={{
                        height: 20, maxWidth: 96, borderRadius: 1,
                        bgcolor: item.label.color, color: readableTextColor(item.label.color),
                        '& .MuiChip-label': { px: 0.75, overflow: 'hidden', textOverflow: 'ellipsis' },
                      }}
                    />
                  ))}
                  {model.hiddenLabelCount > 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
                      +{model.hiddenLabelCount}
                    </Typography>
                  ) : null}
                </Stack>
              ) : null}
            </Box>
            {editable ? (
              <IconButton
                size="small"
                aria-label="Меню задачи"
                onClick={openMenu}
                sx={{ mt: 0.5, mr: 0.5 }}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Stack>
          {editable ? (
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
                    setAssignees.mutate({
                      pageId,
                      id: task.id,
                      participantIds: task.assignees.map((a) => a.participantId),
                      userIdsToMirror: [board.currentUserId],
                    })
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
          ) : null}
        </Card>
      )}
    </Draggable>
  )
}
