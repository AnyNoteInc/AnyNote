'use client'

import { useCallback, useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Draggable,
  Droppable,
  type DraggableProvided,
  type DroppableProvided,
} from '@hello-pangea/dnd'
import { format } from 'date-fns'
import { ru as dateFnsRuLocale } from 'date-fns/locale'
import {
  Box,
  Chip,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreVertIcon,
  Paper,
  Stack,
  Typography,
} from '@repo/ui/components'

import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'
import { AssigneeAvatars } from '../components/assignee-avatars'
import { toDate } from '../lib/dates'
import { SprintMenu } from '../sprint/sprint-menu'
import { sprintStatusColor, sprintStatusLabel } from '../sprint/sprint-status-label'

type SprintHeaderProps = {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly description?: string | null
  readonly startDate?: Date | string | null
  readonly endDate?: Date | string | null
}

type SprintSectionProps =
  | {
      readonly kind: 'sprint'
      readonly pageId: string
      readonly sprint: SprintHeaderProps
      readonly allSprints: BoardData['sprints']
      readonly columns: BoardColumnRow[]
      readonly allTasks: BoardTaskData[]
      readonly tasks: BoardTaskData[]
      readonly members: BoardData['members']
      readonly droppableId: string
      readonly onRemoveTaskFromSprint?: (taskId: string) => void
    }
  | {
      readonly kind: 'backlog'
      readonly tasks: BoardTaskData[]
      readonly members: BoardData['members']
      readonly droppableId: string
    }

interface TaskRowProps {
  readonly task: BoardTaskData
  readonly provided: DraggableProvided
  readonly memberLookup: (userId: string) => { firstName: string | null; email: string } | undefined
  readonly onOpen: (taskId: string) => void
  readonly onRemoveFromSprint?: () => void
}

function TaskRow({ task, provided, memberLookup, onOpen, onRemoveFromSprint }: TaskRowProps) {
  return (
    <Stack
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onClick={() => onOpen(task.id)}
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        py: 1,
        px: 1.25,
        borderRadius: 1,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography variant="body2" sx={{ flex: 1 }}>
        {task.title}
      </Typography>
      <AssigneeAvatars assignees={task.assignees} memberLookup={memberLookup} size={22} />
      {task.dueDate ? (
        <Typography variant="caption" color="text.secondary">
          {new Date(task.dueDate).toLocaleDateString('ru-RU')}
        </Typography>
      ) : null}
      {onRemoveFromSprint ? <TaskRowMenu onRemoveFromSprint={onRemoveFromSprint} /> : null}
    </Stack>
  )
}

interface TaskRowMenuProps {
  readonly onRemoveFromSprint: () => void
}

function TaskRowMenu({ onRemoveFromSprint }: TaskRowMenuProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const stop = (e: MouseEvent) => {
    e.stopPropagation()
  }
  function close(e?: MouseEvent | object) {
    if (e && 'stopPropagation' in e && typeof e.stopPropagation === 'function') {
      e.stopPropagation()
    }
    setAnchorEl(null)
  }
  return (
    <Box onClick={stop}>
      <IconButton
        aria-label="Действия с задачей"
        size="small"
        onClick={(e) => {
          e.stopPropagation()
          setAnchorEl(e.currentTarget)
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        <MenuItem
          onClick={(e) => {
            e.stopPropagation()
            setAnchorEl(null)
            onRemoveFromSprint()
          }}
        >
          <ListItemIcon>
            <MoreVertIcon fontSize="small" sx={{ visibility: 'hidden' }} />
          </ListItemIcon>
          <ListItemText>Удалить из спринта</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  )
}

function formatSprintDates(start: Date | null, end: Date | null): string | null {
  if (!start && !end) return null
  const currentYear = new Date().getFullYear()
  if (start && end) {
    const sameYear = end.getFullYear() === currentYear
    const endPattern = sameYear ? 'd MMM' : 'd MMM yyyy'
    return `${format(start, 'd MMM', { locale: dateFnsRuLocale })} — ${format(end, endPattern, { locale: dateFnsRuLocale })}`
  }
  if (start) return `с ${format(start, 'd MMM', { locale: dateFnsRuLocale })}`
  if (end) return `до ${format(end, 'd MMM', { locale: dateFnsRuLocale })}`
  return null
}

export function SprintSection(props: SprintSectionProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const open = useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('taskId', taskId)
      router.replace(`?${params.toString()}`)
    },
    [router, searchParams],
  )
  const memberLookup = useCallback(
    (userId: string) => {
      const m = props.members.find((x) => x.user.id === userId)
      return m ? { firstName: m.user.firstName, email: m.user.email } : undefined
    },
    [props.members],
  )

  const onRemoveTaskFromSprint =
    props.kind === 'sprint' ? props.onRemoveTaskFromSprint : undefined

  const renderDroppable = (provided: DroppableProvided) => (
    <Box ref={provided.innerRef} {...provided.droppableProps} sx={{ minHeight: 32 }}>
      {props.tasks.map((task, index) => (
        <Draggable key={task.id} draggableId={task.id} index={index}>
          {(p) => (
            <TaskRow
              task={task}
              provided={p}
              memberLookup={memberLookup}
              onOpen={open}
              onRemoveFromSprint={
                onRemoveTaskFromSprint ? () => onRemoveTaskFromSprint(task.id) : undefined
              }
            />
          )}
        </Draggable>
      ))}
      {provided.placeholder}
    </Box>
  )

  const isActive = props.kind === 'sprint' && props.sprint.status === 'ACTIVE'
  const datesText =
    props.kind === 'sprint'
      ? formatSprintDates(toDate(props.sprint.startDate), toDate(props.sprint.endDate))
      : null

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 2,
        p: 1.5,
        borderLeft: isActive ? '3px solid' : undefined,
        borderLeftColor: isActive ? 'primary.main' : undefined,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        {props.kind === 'sprint' ? (
          <>
            <Typography variant="subtitle1" fontWeight={600}>
              {props.sprint.name}
            </Typography>
            {datesText ? (
              <Typography variant="caption" color="text.secondary">
                {datesText}
              </Typography>
            ) : null}
            <Chip
              size="small"
              label={sprintStatusLabel(props.sprint.status)}
              color={sprintStatusColor(props.sprint.status)}
              variant={props.sprint.status === 'PLANNED' ? 'outlined' : 'filled'}
            />
            <Typography variant="caption" color="text.secondary">
              {props.tasks.length}
            </Typography>
            <Box sx={{ ml: 'auto' }}>
              <SprintMenu
                pageId={props.pageId}
                sprint={props.sprint}
                allSprints={props.allSprints}
                columns={props.columns}
                tasks={props.allTasks}
              />
            </Box>
          </>
        ) : (
          <>
            <Typography variant="subtitle1" fontWeight={600}>
              Беклог
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {props.tasks.length}
            </Typography>
          </>
        )}
      </Stack>
      <Droppable droppableId={props.droppableId}>{renderDroppable}</Droppable>
    </Paper>
  )
}
