'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Droppable } from '@hello-pangea/dnd'
import {
  AddIcon,
  Box,
  Button,
  DeleteIcon,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  MoreVertIcon,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardColumnWithTasks, BoardData } from '../types'
import { BoardCard } from './board-card'

interface BoardColumnProps {
  readonly pageId: string
  readonly column: BoardColumnWithTasks
  readonly board: BoardData
  readonly childCountByParent: Map<string, number>
  readonly editable?: boolean
  readonly addSprintId?: string
}

export function BoardColumn({
  pageId,
  column,
  board,
  childCountByParent,
  editable = true,
  addSprintId,
}: BoardColumnProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        width: 320,
        flexShrink: 0,
        p: 1.5,
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '100%',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {column.title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {column.tasks.length}
        </Typography>
        {editable ? (
          <ColumnMenu pageId={pageId} columnId={column.id} canDelete={board.columns.length > 1} />
        ) : null}
      </Stack>
      <Droppable droppableId={column.id}>
        {(provided) => (
          <Box
            ref={provided.innerRef}
            {...provided.droppableProps}
            sx={{ minHeight: 40, flex: 1, overflowY: 'auto' }}
          >
            {column.tasks.map((task, index) => (
              <BoardCard
                key={task.id}
                pageId={pageId}
                task={task}
                index={index}
                board={board}
                childCount={childCountByParent.get(task.id) ?? 0}
                editable={editable}
              />
            ))}
            {provided.placeholder}
          </Box>
        )}
      </Droppable>
      {editable ? (
        <AddCardForm pageId={pageId} columnId={column.id} addSprintId={addSprintId} />
      ) : null}
    </Paper>
  )
}

interface ColumnMenuProps {
  readonly pageId: string
  readonly columnId: string
  readonly canDelete: boolean
}

function ColumnMenu({ pageId, columnId, canDelete }: ColumnMenuProps) {
  const utils = trpc.useUtils()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const deleteColumn = trpc.kanban.column.delete.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  function close() {
    setAnchorEl(null)
  }

  function handleDelete() {
    close()
    if (!canDelete) return
    deleteColumn.mutate({ pageId, id: columnId })
  }

  return (
    <>
      <IconButton
        aria-label="Действия со списком"
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
          Действия над списком
        </ListSubheader>
        <MenuItem
          onClick={handleDelete}
          disabled={!canDelete || deleteColumn.isPending}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'error.main' }}>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Удалить список</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}

interface AddCardFormProps {
  readonly pageId: string
  readonly columnId: string
  readonly addSprintId?: string
}

function AddCardForm({ pageId, columnId, addSprintId }: AddCardFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()
  const createTask = trpc.kanban.task.create.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const skipBlurRef = useRef(false)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function open() {
    setTitle('')
    setEditing(true)
  }
  function close() {
    setEditing(false)
    setTitle('')
  }

  async function commit({ openDetail }: { readonly openDetail: boolean }) {
    const trimmed = title.trim()
    if (!trimmed) {
      close()
      return
    }
    setTitle('')
    const created = await createTask.mutateAsync({
      pageId,
      columnId,
      title: trimmed,
      ...(addSprintId ? { sprintId: addSprintId } : {}),
    })
    if (openDetail) {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('taskId', created.id)
      params.set('new', '1')
      router.replace(`?${params.toString()}`)
      close()
      return
    }
    inputRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit({ openDetail: false })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      skipBlurRef.current = true
      close()
    }
  }

  if (!editing) {
    return (
      <>
        <Divider sx={{ mt: 1 }} />
        <Button
          startIcon={<AddIcon fontSize="small" />}
          onClick={open}
          size="small"
          variant="outlined"
          color="inherit"
          disableRipple
          sx={{
            mt: 1,
            justifyContent: 'flex-start',
            color: 'text.secondary',
            textTransform: 'none',
            borderColor: 'divider',
            '&:hover': { bgcolor: 'transparent', color: 'text.secondary', borderColor: 'divider' },
            '&:active': { bgcolor: 'transparent', color: 'text.secondary', borderColor: 'divider' },
            '&:focus-visible': { bgcolor: 'transparent', color: 'text.secondary' },
          }}
          fullWidth
        >
          Добавить карточку
        </Button>
      </>
    )
  }

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <Divider />
      <TextField
        inputRef={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false
            return
          }
          void commit({ openDetail: false })
        }}
        placeholder="Введите название карточки…"
        size="small"
        multiline
        minRows={2}
        autoFocus
        sx={{ bgcolor: 'background.paper' }}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          variant="contained"
          size="small"
          onMouseDown={(e) => {
            e.preventDefault()
            skipBlurRef.current = true
          }}
          onClick={() => void commit({ openDetail: false })}
          disabled={createTask.isPending}
        >
          Добавить
        </Button>
        <Button
          size="small"
          onMouseDown={(e) => {
            e.preventDefault()
            skipBlurRef.current = true
          }}
          onClick={close}
        >
          Отмена
        </Button>
      </Stack>
    </Stack>
  )
}
