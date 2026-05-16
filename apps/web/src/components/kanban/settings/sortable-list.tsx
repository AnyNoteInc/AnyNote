'use client'

import { useState } from 'react'
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DropResult,
} from '@hello-pangea/dnd'
import {
  AddIcon,
  Box,
  Button,
  CloseIcon,
  IconButton,
  Stack,
  TextField,
} from '@repo/ui/components'

export interface SortableItem {
  id: string
  title: string
  position: number
  color?: string | null
}

interface SortableListProps {
  readonly items: SortableItem[]
  readonly onAdd: (title: string) => Promise<unknown> | void
  readonly onRename: (id: string, title: string) => Promise<unknown> | void
  readonly onReorder: (
    id: string,
    beforeId: string | null,
    afterId: string | null,
  ) => Promise<unknown> | void
  readonly onDelete?: (id: string) => Promise<unknown> | void
  readonly canDelete?: (id: string) => boolean
  readonly addPlaceholder?: string
  readonly extraColumn?: (item: SortableItem) => React.ReactNode
}

interface RowProps {
  readonly item: SortableItem
  readonly provided: DraggableProvided
  readonly isEditing: boolean
  readonly editValue: string
  readonly onStartEdit: () => void
  readonly onEditChange: (value: string) => void
  readonly onCommitEdit: () => void
  readonly onCancelEdit: () => void
  readonly onDelete?: () => void
  readonly extra?: React.ReactNode
}

interface DraggableRowProps {
  readonly item: SortableItem
  readonly index: number
  readonly isEditing: boolean
  readonly editValue: string
  readonly onStartEdit: (item: SortableItem) => void
  readonly onEditChange: (id: string, value: string) => void
  readonly onCommitEdit: (id: string) => void
  readonly onCancelEdit: () => void
  readonly onDelete?: (id: string) => void
  readonly extra?: React.ReactNode
}

function DraggableSortableRow(props: DraggableRowProps) {
  const { item, onDelete } = props
  const handleDelete = onDelete ? () => onDelete(item.id) : undefined
  const renderRow = (p: DraggableProvided) => (
    <SortableRow
      item={item}
      provided={p}
      isEditing={props.isEditing}
      editValue={props.editValue}
      onStartEdit={() => props.onStartEdit(item)}
      onEditChange={(value) => props.onEditChange(item.id, value)}
      onCommitEdit={() => props.onCommitEdit(item.id)}
      onCancelEdit={props.onCancelEdit}
      onDelete={handleDelete}
      extra={props.extra}
    />
  )
  return (
    <Draggable draggableId={item.id} index={props.index}>
      {renderRow}
    </Draggable>
  )
}

function SortableRow({
  item,
  provided,
  isEditing,
  editValue,
  onStartEdit,
  onEditChange,
  onCommitEdit,
  onCancelEdit,
  onDelete,
  extra,
}: RowProps) {
  return (
    <Stack
      ref={provided.innerRef}
      {...provided.draggableProps}
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        py: 1,
        px: 1.25,
        borderRadius: 1,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        mb: 0.5,
      }}
    >
      <Box {...provided.dragHandleProps} sx={{ cursor: 'grab', color: 'text.disabled' }}>
        ⋮⋮
      </Box>
      {item.color ? (
        <Box
          sx={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            bgcolor: item.color,
            flexShrink: 0,
          }}
        />
      ) : null}
      {isEditing ? (
        <TextField
          size="small"
          value={editValue}
          autoFocus
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit()
            if (e.key === 'Escape') onCancelEdit()
          }}
          sx={{ flex: 1 }}
        />
      ) : (
        <Box sx={{ flex: 1, cursor: 'text' }} onDoubleClick={onStartEdit}>
          {item.title}
        </Box>
      )}
      {extra}
      {onDelete ? (
        <IconButton size="small" onClick={onDelete}>
          <CloseIcon fontSize="small" />
        </IconButton>
      ) : null}
    </Stack>
  )
}

export function SortableList({
  items,
  onAdd,
  onRename,
  onReorder,
  onDelete,
  canDelete,
  addPlaceholder = 'Добавить',
  extraColumn,
}: SortableListProps) {
  const [newTitle, setNewTitle] = useState('')
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const sorted = [...items].sort((a, b) => a.position - b.position)

  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    if (result.source.index === result.destination.index) return
    const moved = sorted[result.source.index]
    if (!moved) return
    const remaining = sorted.filter((_, i) => i !== result.source.index)
    const before = remaining[result.destination.index - 1] ?? null
    const after = remaining[result.destination.index] ?? null
    await onReorder(moved.id, before?.id ?? null, after?.id ?? null)
  }

  async function submitAdd() {
    const title = newTitle.trim()
    if (!title) return
    await onAdd(title)
    setNewTitle('')
  }

  async function submitRename(id: string, value: string) {
    setEditing(null)
    const trimmed = value.trim()
    if (!trimmed) return
    await onRename(id, trimmed)
  }

  return (
    <Stack spacing={1.5} sx={{ minWidth: 360 }}>
      <Stack direction="row" spacing={1}>
        <TextField
          placeholder={addPlaceholder}
          size="small"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitAdd()
          }}
          fullWidth
        />
        <Button startIcon={<AddIcon />} variant="outlined" onClick={submitAdd}>
          Добавить
        </Button>
      </Stack>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="settings-sortable">
          {(provided) => (
            <Box ref={provided.innerRef} {...provided.droppableProps}>
              {sorted.map((item, index) => {
                const isEditing = editing?.id === item.id
                const showDelete = onDelete && (!canDelete || canDelete(item.id))
                return (
                  <DraggableSortableRow
                    key={item.id}
                    item={item}
                    index={index}
                    isEditing={isEditing}
                    editValue={editing?.value ?? ''}
                    onStartEdit={(it) => setEditing({ id: it.id, value: it.title })}
                    onEditChange={(id, value) => setEditing({ id, value })}
                    onCommitEdit={(id) => void submitRename(id, editing?.value ?? '')}
                    onCancelEdit={() => setEditing(null)}
                    onDelete={showDelete && onDelete ? (id) => onDelete(id) : undefined}
                    extra={extraColumn?.(item)}
                  />
                )
              })}
              {provided.placeholder}
            </Box>
          )}
        </Droppable>
      </DragDropContext>
    </Stack>
  )
}
