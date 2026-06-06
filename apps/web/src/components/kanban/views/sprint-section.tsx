'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
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
  AddIcon,
  Box,
  Checkbox,
  Chip,
  DeleteIcon,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreVertIcon,
  Paper,
  PersonAddIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'
import { AssigneeAvatars } from '../components/assignee-avatars'
import { ParentBadge } from '../components/parent-badge'
import { parentTitleFontWeight } from '../lib/parent-style'
import { isAssignedTo } from '../lib/assignees'
import { useSelection } from '../selection/selection-context'
import { toDate } from '../lib/dates'
import { SprintMenu } from '../sprint/sprint-menu'
import { sprintStatusColor, sprintStatusLabel } from '../sprint/sprint-status-label'
import { isTerminalTask } from './table-view-model'
import { computeDeviation, formatDeviation } from './deviation'

type SprintHeaderProps = {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly description?: string | null
  readonly startDate?: Date | string | null
  readonly endDate?: Date | string | null
}

interface CreateTaskDraftProps {
  readonly title: string
  readonly disabled?: boolean
  readonly onTitleChange: (title: string) => void
  readonly onCommit: () => void
  readonly onCancel: () => void
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
      readonly currentUserId: string
      readonly droppableId: string
      readonly editable?: boolean
      readonly onStartCreateTask?: () => void
      readonly createTaskDraft?: CreateTaskDraftProps
      readonly onAssignTaskToMe?: (taskId: string) => void
      readonly onRemoveTaskFromSprint?: (taskId: string) => void
      readonly onDeleteTask?: (taskId: string) => void
      readonly childCountByParent: Map<string, number>
    }
  | {
      readonly kind: 'backlog'
      readonly tasks: BoardTaskData[]
      readonly members: BoardData['members']
      readonly currentUserId: string
      readonly droppableId: string
      readonly editable?: boolean
      readonly onStartCreateTask?: () => void
      readonly createTaskDraft?: CreateTaskDraftProps
      readonly onAssignTaskToMe?: (taskId: string) => void
      readonly onDeleteTask?: (taskId: string) => void
      readonly childCountByParent: Map<string, number>
    }

interface TaskRowProps {
  readonly task: BoardTaskData
  readonly provided: DraggableProvided
  readonly currentUserId: string
  readonly editable?: boolean
  readonly onOpen: (taskId: string) => void
  readonly onAssignToMe?: () => void
  readonly onRemoveFromSprint?: () => void
  readonly onDeleteTask?: () => void
  readonly strikeTitle?: boolean
  readonly childCount: number
}

function TaskRow({
  task,
  childCount,
  provided,
  currentUserId,
  editable = true,
  onOpen,
  onAssignToMe,
  onRemoveFromSprint,
  onDeleteTask,
  strikeTitle = false,
}: TaskRowProps) {
  const { selected, toggle } = useSelection()
  const canAssignToMe = Boolean(onAssignToMe && !isAssignedTo(task.assignees, currentUserId))
  const hasActions = canAssignToMe || Boolean(onRemoveFromSprint || onDeleteTask)
  const deviation = computeDeviation(toDate(task.dueDate), toDate(task.actualDate))

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
      {editable ? (
        <Checkbox
          size="small"
          checked={selected.has(task.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggle(task.id)}
          inputProps={{ 'aria-label': `Выбрать задачу: ${task.title}` }}
          sx={{ p: 0.5 }}
        />
      ) : null}
      {childCount > 0 ? <ParentBadge count={childCount} /> : null}
      <Typography
        variant="body2"
        sx={{
          flex: 1,
          fontWeight: parentTitleFontWeight(childCount > 0, undefined),
          textDecoration: strikeTitle ? 'line-through' : undefined,
          color: strikeTitle ? 'text.secondary' : undefined,
        }}
      >
        {task.title}
      </Typography>
      <AssigneeAvatars assignees={task.assignees} size={22} />
      {task.dueDate ? (
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          План: {toDate(task.dueDate)?.toLocaleDateString('ru-RU')}
        </Typography>
      ) : null}
      {task.actualDate ? (
        <Typography variant="caption" sx={{ color: '#15803D', whiteSpace: 'nowrap' }}>
          Факт: {toDate(task.actualDate)?.toLocaleDateString('ru-RU')}
        </Typography>
      ) : null}
      {deviation ? (
        <Typography
          variant="caption"
          sx={{ whiteSpace: 'nowrap', color: deviation.tone === 'late' ? '#B91C1C' : '#15803D' }}
        >
          {formatDeviation(deviation)}
        </Typography>
      ) : null}
      {hasActions ? (
        <TaskRowMenu
          onAssignToMe={canAssignToMe ? onAssignToMe : undefined}
          onRemoveFromSprint={onRemoveFromSprint}
          onDeleteTask={onDeleteTask}
        />
      ) : null}
    </Stack>
  )
}

interface TaskRowMenuProps {
  readonly onAssignToMe?: () => void
  readonly onRemoveFromSprint?: () => void
  readonly onDeleteTask?: () => void
}

function TaskRowMenu({ onAssignToMe, onRemoveFromSprint, onDeleteTask }: TaskRowMenuProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const stop = (e: MouseEvent) => {
    e.stopPropagation()
  }
  function selectAction(e: MouseEvent, action: () => void) {
    e.stopPropagation()
    setAnchorEl(null)
    action()
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
        disableRestoreFocus
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        {onAssignToMe ? (
          <MenuItem onClick={(e) => selectAction(e, onAssignToMe)}>
            <ListItemIcon>
              <PersonAddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Назначить на меня</ListItemText>
          </MenuItem>
        ) : null}
        {onRemoveFromSprint ? (
          <MenuItem onClick={(e) => selectAction(e, onRemoveFromSprint)}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Удалить из спринта</ListItemText>
          </MenuItem>
        ) : null}
        {onRemoveFromSprint && onDeleteTask ? <Divider /> : null}
        {onDeleteTask ? (
          <MenuItem onClick={(e) => selectAction(e, onDeleteTask)} sx={{ color: 'error.main' }}>
            <ListItemIcon sx={{ color: 'error.main' }}>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Удалить</ListItemText>
          </MenuItem>
        ) : null}
      </Menu>
    </Box>
  )
}

interface BacklogMenuProps {
  readonly onStartCreateTask: () => void
}

function BacklogMenu({ onStartCreateTask }: BacklogMenuProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  function close() {
    setAnchorEl(null)
  }

  function startCreateTask() {
    close()
    onStartCreateTask()
  }

  return (
    <>
      <IconButton
        aria-label="Действия с беклогом"
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        disableRestoreFocus
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        <MenuItem onClick={startCreateTask}>
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Создать задачу</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}

function CreateTaskDraftRow({
  title,
  disabled,
  onTitleChange,
  onCommit,
  onCancel,
}: CreateTaskDraftProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const skipBlurRef = useRef(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onCommit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      skipBlurRef.current = true
      onCancel()
    }
  }

  return (
    <Box sx={{ py: 0.5, px: 1.25 }}>
      <TextField
        inputRef={inputRef}
        label="Название задачи"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false
            return
          }
          onCommit()
        }}
        size="small"
        fullWidth
        autoFocus
        disabled={disabled}
      />
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
  const canEdit = props.editable ?? true
  const onRemoveTaskFromSprint = props.kind === 'sprint' ? props.onRemoveTaskFromSprint : undefined
  const onAssignTaskToMe = props.onAssignTaskToMe
  const onDeleteTask = props.onDeleteTask
  const createTaskDraft = props.createTaskDraft
  const shouldStrikeTerminalTasks = props.kind === 'sprint'

  const renderDroppable = (provided: DroppableProvided) => (
    <Box ref={provided.innerRef} {...provided.droppableProps} sx={{ minHeight: 32 }}>
      {createTaskDraft ? <CreateTaskDraftRow {...createTaskDraft} /> : null}
      {props.tasks.map((task, index) => (
        <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={!canEdit}>
          {(p) => (
            <TaskRow
              task={task}
              childCount={props.childCountByParent.get(task.id) ?? 0}
              provided={p}
              currentUserId={props.currentUserId}
              editable={canEdit}
              onOpen={open}
              onAssignToMe={onAssignTaskToMe ? () => onAssignTaskToMe(task.id) : undefined}
              onRemoveFromSprint={
                onRemoveTaskFromSprint ? () => onRemoveTaskFromSprint(task.id) : undefined
              }
              onDeleteTask={onDeleteTask ? () => onDeleteTask(task.id) : undefined}
              strikeTitle={shouldStrikeTerminalTasks ? isTerminalTask(task, props.columns) : false}
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
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {props.tasks.length}
            </Typography>
            {canEdit ? (
              <SprintMenu
                pageId={props.pageId}
                sprint={props.sprint}
                allSprints={props.allSprints}
                columns={props.columns}
                tasks={props.allTasks}
                onCreateTask={props.onStartCreateTask}
              />
            ) : null}
          </>
        ) : (
          <>
            <Typography variant="subtitle1" fontWeight={600}>
              Беклог
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {props.tasks.length}
            </Typography>
            {props.onStartCreateTask ? (
              <BacklogMenu onStartCreateTask={props.onStartCreateTask} />
            ) : null}
          </>
        )}
      </Stack>
      <Droppable droppableId={props.droppableId}>{renderDroppable}</Droppable>
    </Paper>
  )
}
