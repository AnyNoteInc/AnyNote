'use client'

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AdapterDateFns,
  Box,
  Checkbox,
  Chip,
  DatePicker,
  dateFnsRu,
  ListItemText,
  LocalizationProvider,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
import { AnyNotePlainEditor, type JSONContent } from '@repo/editor'

import { trpc } from '@/trpc/client'
import type { BoardData, BoardTaskData } from '../types'
import { TaskAttachments } from './task-attachments'
import { ManageListPopover } from './manage-list-popover'

interface TaskFormProps {
  readonly pageId: string
  readonly task: BoardTaskData
  readonly board: BoardData
  readonly currentUserId: string
}

function memberLabel(m: BoardData['members'][number]) {
  return `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email
}

function readDescriptionJson(value: unknown): JSONContent | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (obj.type === 'doc' && Array.isArray(obj.content)) return obj as JSONContent
  if (typeof obj.text === 'string' && obj.text) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: obj.text }] }],
    }
  }
  return null
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  return new Date(value)
}

type PopoverKey =
  | 'type'
  | 'priority'
  | 'dates'
  | 'assignees'
  | 'labels'
  | 'sprint'
  | 'parent'
  | null

export function TaskForm({ pageId, task, board, currentUserId }: TaskFormProps) {
  const utils = trpc.useUtils()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isNew = searchParams?.get('new') === '1'

  useEffect(() => {
    if (!isNew) return
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('new')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : globalThis.location.pathname)
  }, [isNew, router, searchParams])

  const invalidateBoard = () => utils.kanban.board.getBoard.invalidate({ pageId })
  const updateTask = trpc.kanban.task.update.useMutation({ onSuccess: invalidateBoard })
  const setAssignees = trpc.kanban.task.setAssignees.useMutation({ onSuccess: invalidateBoard })
  const setLabels = trpc.kanban.task.setLabels.useMutation({ onSuccess: invalidateBoard })

  const typeCreate = trpc.kanban.type.create.useMutation({ onSuccess: invalidateBoard })
  const typeDelete = trpc.kanban.type.delete.useMutation({ onSuccess: invalidateBoard })

  const priorityCreate = trpc.kanban.priority.create.useMutation({ onSuccess: invalidateBoard })
  const priorityDelete = trpc.kanban.priority.delete.useMutation({ onSuccess: invalidateBoard })

  const labelCreate = trpc.kanban.label.create.useMutation({ onSuccess: invalidateBoard })
  const labelDelete = trpc.kanban.label.delete.useMutation({ onSuccess: invalidateBoard })

  const [description, setDescription] = useState<JSONContent | null>(
    readDescriptionJson(task.description),
  )
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task.assignees.map((a) => a.user.id))
  const [labelIds, setLabelIds] = useState<string[]>(task.labels.map((l) => l.labelId))
  const [typeId, setTypeId] = useState<string>(task.typeId ?? '')
  const [priorityId, setPriorityId] = useState<string>(task.priorityId ?? '')
  const [sprintId, setSprintId] = useState<string>(task.sprintId ?? '')
  const [parentId, setParentId] = useState<string>(task.parentId ?? '')
  const [dueDate, setDueDate] = useState<Date | null>(toDate(task.dueDate))
  const [startDate, setStartDate] = useState<Date | null>(toDate(task.startDate))

  useEffect(() => setAssigneeIds(task.assignees.map((a) => a.user.id)), [task.assignees])
  useEffect(() => setLabelIds(task.labels.map((l) => l.labelId)), [task.labels])
  useEffect(() => setTypeId(task.typeId ?? ''), [task.typeId])
  useEffect(() => setPriorityId(task.priorityId ?? ''), [task.priorityId])
  useEffect(() => setSprintId(task.sprintId ?? ''), [task.sprintId])
  useEffect(() => setParentId(task.parentId ?? ''), [task.parentId])
  useEffect(() => setDueDate(toDate(task.dueDate)), [task.dueDate])
  useEffect(() => setStartDate(toDate(task.startDate)), [task.startDate])

  const parentCandidates = useMemo(
    () => board.tasks.filter((t) => t.id !== task.id),
    [board.tasks, task.id],
  )
  const selectedType = board.types.find((t) => t.id === typeId)
  const selectedPriority = board.priorities.find((p) => p.id === priorityId)

  const onDescriptionSave = useCallback(
    (value: JSONContent | null) => {
      setDescription(value)
      updateTask.mutate({ pageId, id: task.id, description: value })
    },
    [pageId, task.id, updateTask],
  )

  const typeItems = useMemo(
    () =>
      board.types
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((t) => ({ id: t.id, label: t.title })),
    [board.types],
  )
  const priorityItems = useMemo(
    () =>
      board.priorities
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((p) => ({ id: p.id, label: p.title })),
    [board.priorities],
  )
  const labelItems = useMemo(
    () =>
      board.labels
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ id: l.id, label: l.name, color: l.color })),
    [board.labels],
  )

  const [popover, setPopover] = useState<PopoverKey>(null)
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)
  function openPopover(key: Exclude<PopoverKey, null>) {
    return (e: ReactMouseEvent<HTMLElement>) => {
      setPopoverAnchor(e.currentTarget)
      setPopover(key)
    }
  }
  function closePopover() {
    setPopover(null)
    setPopoverAnchor(null)
  }

  function selectType(id: string) {
    const next = typeId === id ? '' : id
    setTypeId(next)
    updateTask.mutate({ pageId, id: task.id, typeId: next || null })
  }
  function selectPriority(id: string) {
    const next = priorityId === id ? '' : id
    setPriorityId(next)
    updateTask.mutate({ pageId, id: task.id, priorityId: next || null })
  }
  function toggleLabel(id: string) {
    const next = labelIds.includes(id) ? labelIds.filter((x) => x !== id) : [...labelIds, id]
    setLabelIds(next)
    setLabels.mutate({ pageId, id: task.id, labelIds: next })
  }
  function toggleAssignee(userId: string) {
    const next = assigneeIds.includes(userId)
      ? assigneeIds.filter((x) => x !== userId)
      : [...assigneeIds, userId]
    setAssigneeIds(next)
    setAssignees.mutate({ pageId, id: task.id, userIds: next })
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
      <Stack spacing={3}>
        <InlineEditableTitle
          value={task.title}
          autoFocus={isNew}
          onSave={(next) => {
            if (next === task.title) return
            updateTask.mutate({ pageId, id: task.id, title: next })
          }}
        />

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ rowGap: 1 }}
        >
          <ActionChip
            label={selectedType ? `Тип: ${selectedType.title}` : 'Тип'}
            highlighted={Boolean(selectedType)}
            onClick={openPopover('type')}
            onClear={
              selectedType
                ? () => {
                    setTypeId('')
                    updateTask.mutate({ pageId, id: task.id, typeId: null })
                  }
                : undefined
            }
          />
          <ActionChip
            label={selectedPriority ? `Срочность: ${selectedPriority.title}` : 'Срочность'}
            highlighted={Boolean(selectedPriority)}
            onClick={openPopover('priority')}
            onClear={
              selectedPriority
                ? () => {
                    setPriorityId('')
                    updateTask.mutate({ pageId, id: task.id, priorityId: null })
                  }
                : undefined
            }
          />
          <ActionChip
            label={
              startDate || dueDate
                ? `Даты: ${formatDateRange(startDate, dueDate)}`
                : 'Даты'
            }
            highlighted={Boolean(startDate || dueDate)}
            onClick={openPopover('dates')}
          />
          <ActionChip
            label={assigneeIds.length > 0 ? `Участники (${assigneeIds.length})` : 'Участники'}
            highlighted={assigneeIds.length > 0}
            onClick={openPopover('assignees')}
          />
          <ActionChip
            label={labelIds.length > 0 ? `Метки (${labelIds.length})` : 'Метки'}
            highlighted={labelIds.length > 0}
            onClick={openPopover('labels')}
          />
          {board.sprints.length > 0 ? (
            <ActionChip
              label={
                sprintId
                  ? `Спринт: ${board.sprints.find((s) => s.id === sprintId)?.name ?? ''}`
                  : 'Спринт'
              }
              highlighted={Boolean(sprintId)}
              onClick={openPopover('sprint')}
              onClear={
                sprintId
                  ? () => {
                      setSprintId('')
                      updateTask.mutate({ pageId, id: task.id, sprintId: null })
                    }
                  : undefined
              }
            />
          ) : null}
          <ActionChip
            label={
              parentId
                ? `Родительская задача: ${
                    parentCandidates.find((p) => p.id === parentId)?.title ?? ''
                  }`
                : 'Родительская задача'
            }
            highlighted={Boolean(parentId)}
            onClick={openPopover('parent')}
          />
        </Stack>

        <Section heading="Описание">
          <DescriptionEditor value={description} onBlurSave={onDescriptionSave} />
        </Section>

        <TaskAttachments
          pageId={pageId}
          workspaceId={board.workspaceId}
          taskId={task.id}
          currentUserId={currentUserId}
        />

        <ManageListPopover
          open={popover === 'type'}
          anchorEl={popoverAnchor}
          onClose={closePopover}
          title="Тип задачи"
          mode="single"
          items={typeItems}
          selectedIds={typeId ? [typeId] : []}
          addPlaceholder="Новый тип…"
          onToggle={selectType}
          onCreate={({ name }) => typeCreate.mutate({ pageId, title: name })}
          onDelete={(id) => {
            if (typeId === id) {
              setTypeId('')
              updateTask.mutate({ pageId, id: task.id, typeId: null })
            }
            typeDelete.mutate({ pageId, id })
          }}
        />

        <ManageListPopover
          open={popover === 'priority'}
          anchorEl={popoverAnchor}
          onClose={closePopover}
          title="Срочность"
          mode="single"
          items={priorityItems}
          selectedIds={priorityId ? [priorityId] : []}
          addPlaceholder="Новая срочность…"
          onToggle={selectPriority}
          onCreate={({ name }) => priorityCreate.mutate({ pageId, title: name })}
          onDelete={(id) => {
            if (priorityId === id) {
              setPriorityId('')
              updateTask.mutate({ pageId, id: task.id, priorityId: null })
            }
            priorityDelete.mutate({ pageId, id })
          }}
        />

        <ManageListPopover
          open={popover === 'labels'}
          anchorEl={popoverAnchor}
          onClose={closePopover}
          title="Метки"
          mode="multi"
          withColor
          items={labelItems}
          selectedIds={labelIds}
          addPlaceholder="Новая метка…"
          onToggle={toggleLabel}
          onCreate={({ name, color }) =>
            labelCreate.mutate({ pageId, name, color: color ?? '#6B7280' })
          }
          onDelete={(id) => {
            if (labelIds.includes(id)) {
              const next = labelIds.filter((x) => x !== id)
              setLabelIds(next)
              setLabels.mutate({ pageId, id: task.id, labelIds: next })
            }
            labelDelete.mutate({ pageId, id })
          }}
        />

        <Popover
          open={popover === 'dates'}
          anchorEl={popoverAnchor}
          onClose={closePopover}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transitionDuration={0}
        >
          {popover === 'dates' ? (
            <Stack spacing={2} sx={{ p: 2, minWidth: 280 }}>
              <DatePicker
                label="Дата старта"
                value={startDate}
                onChange={(value) => {
                  setStartDate(value)
                  updateTask.mutate({ pageId, id: task.id, startDate: value })
                }}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
              <DatePicker
                label="Срок"
                value={dueDate}
                onChange={(value) => {
                  setDueDate(value)
                  updateTask.mutate({ pageId, id: task.id, dueDate: value })
                }}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
            </Stack>
          ) : null}
        </Popover>

        <Popover
          open={popover === 'assignees'}
          anchorEl={popoverAnchor}
          onClose={closePopover}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transitionDuration={0}
        >
          {popover === 'assignees' ? (
            <Box sx={{ p: 1.5, minWidth: 280, maxWidth: 320 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 1, fontWeight: 600 }}
              >
                Исполнители
              </Typography>
              {board.members.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  В рабочей области нет участников
                </Typography>
              ) : (
                <Stack spacing={0.25} sx={{ maxHeight: 320, overflowY: 'auto' }}>
                  {board.members.map((m) => {
                    const checked = assigneeIds.includes(m.user.id)
                    return (
                      <Stack
                        key={m.user.id}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        onClick={() => toggleAssignee(m.user.id)}
                        sx={{
                          px: 0.5,
                          py: 0.25,
                          borderRadius: 1,
                          cursor: 'pointer',
                          bgcolor: checked ? 'action.selected' : 'transparent',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <Checkbox checked={checked} size="small" sx={{ p: 0.5 }} />
                        <Box
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 14,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {memberLabel(m)}
                        </Box>
                      </Stack>
                    )
                  })}
                </Stack>
              )}
            </Box>
          ) : null}
        </Popover>

        <Popover
          open={popover === 'sprint'}
          anchorEl={popoverAnchor}
          onClose={closePopover}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transitionDuration={0}
        >
          {popover === 'sprint' ? (
          <Box sx={{ p: 1.5, minWidth: 240 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 1, fontWeight: 600 }}
            >
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
                closePopover()
              }}
            >
              {board.sprints.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
          </Box>
          ) : null}
        </Popover>

        <Popover
          open={popover === 'parent'}
          anchorEl={popoverAnchor}
          onClose={closePopover}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transitionDuration={0}
        >
          {popover === 'parent' ? (
            <Box sx={{ p: 1.5, minWidth: 280 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 1, fontWeight: 600 }}
              >
                Родительская задача
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
                    <ListItemText primary={p.title} />
                  </MenuItem>
                ))}
              </Select>
            </Box>
          ) : null}
        </Popover>
      </Stack>
    </LocalizationProvider>
  )
}

interface InlineEditableTitleProps {
  readonly value: string
  readonly autoFocus?: boolean
  readonly onSave: (next: string) => void
}

function InlineEditableTitle({ value, autoFocus, onSave }: InlineEditableTitleProps) {
  const [editing, setEditing] = useState(autoFocus ?? false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    const trimmed = draft.trim()
    setEditing(false)
    if (!trimmed) {
      setDraft(value)
      return
    }
    onSave(trimmed)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
  }

  if (editing) {
    return (
      <TextField
        inputRef={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        placeholder="Название карточки"
        fullWidth
        multiline
        variant="outlined"
        slotProps={{
          input: {
            sx: {
              fontSize: '1rem',
              fontWeight: 700,
              lineHeight: 1.4,
            },
          },
        }}
      />
    )
  }

  return (
    <Typography
      variant="body1"
      onClick={() => setEditing(true)}
      sx={{
        fontWeight: 700,
        cursor: 'text',
        wordBreak: 'break-word',
        px: 1,
        py: 0.5,
        ml: -1,
        borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {value || 'Название карточки'}
    </Typography>
  )
}

interface ActionChipProps {
  readonly label: string
  readonly icon?: React.ReactNode
  readonly highlighted?: boolean
  readonly onClick: (e: ReactMouseEvent<HTMLElement>) => void
  readonly onClear?: () => void
}

function ActionChip({ label, icon, highlighted, onClick, onClear }: ActionChipProps) {
  return (
    <Chip
      label={label}
      icon={icon as React.ReactElement | undefined}
      onClick={onClick}
      onDelete={onClear}
      variant={highlighted ? 'filled' : 'outlined'}
      color={highlighted ? 'primary' : 'default'}
      sx={{
        borderRadius: 1,
        fontWeight: 500,
        '& .MuiChip-label': { px: 1.25 },
      }}
    />
  )
}

interface SectionProps {
  readonly heading: string
  readonly children: React.ReactNode
}

function Section({ heading, children }: SectionProps) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontWeight: 600 }}>
        {heading}
      </Typography>
      {children}
    </Box>
  )
}

function formatDateRange(start: Date | null, due: Date | null): string {
  const fmt = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
  if (start && due) return `${fmt(start)} – ${fmt(due)}`
  if (due) return `до ${fmt(due)}`
  if (start) return `с ${fmt(start)}`
  return ''
}

interface DescriptionEditorProps {
  readonly value: JSONContent | null
  readonly onBlurSave: (value: JSONContent | null) => void
}

const DescriptionEditor = memo(function DescriptionEditor({
  value,
  onBlurSave,
}: DescriptionEditorProps) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        minHeight: 120,
        transition: 'border-color 120ms',
        '&:focus-within': { borderColor: 'primary.main' },
        '& .ProseMirror': { outline: 'none', minHeight: 96, px: 1.5, py: 1 },
      }}
    >
      <AnyNotePlainEditor
        value={value}
        placeholder="Добавить более подробное описание..."
        onBlurSave={onBlurSave}
      />
    </Box>
  )
})
