'use client'

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  DragDropContext,
  Draggable,
  type DraggableProvidedDragHandleProps,
  type DraggableProvidedDraggableProps,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd'
import {
  AddIcon,
  Box,
  Checkbox,
  DeleteIcon,
  DragIndicatorIcon,
  IconButton,
  Popover,
  Radio,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { KANBAN_LABEL_COLORS } from '@repo/ui/lib/kanban-colors'

export interface ManageListItem {
  readonly id: string
  readonly label: string
  readonly color?: string | null
}

export type ManageListMode = 'single' | 'multi'

interface ManageListPopoverProps {
  readonly open: boolean
  readonly anchorEl: HTMLElement | null
  readonly onClose: () => void
  readonly title: string
  readonly mode: ManageListMode
  readonly items: ReadonlyArray<ManageListItem>
  readonly selectedIds: ReadonlyArray<string>
  readonly addPlaceholder?: string
  readonly withColor?: boolean
  readonly onToggle: (id: string) => void
  readonly onCreate: (input: { readonly name: string; readonly color?: string }) => void
  readonly onDelete: (id: string) => void
  readonly onReorder: (
    id: string,
    beforeId: string | null,
    afterId: string | null,
  ) => void
}

export function ManageListPopover(props: ManageListPopoverProps) {
  const { open, anchorEl, onClose } = props
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      {open ? <ManageListBody {...props} /> : null}
    </Popover>
  )
}

function ManageListBody({
  title,
  mode,
  items,
  selectedIds,
  addPlaceholder = 'Новый элемент…',
  withColor = false,
  onToggle,
  onCreate,
  onDelete,
  onReorder,
}: ManageListPopoverProps) {
  const [draft, setDraft] = useState('')
  const [draftColor, setDraftColor] = useState<string>(
    KANBAN_LABEL_COLORS[0]?.hex ?? '#6B7280',
  )
  const [dndReady, setDndReady] = useState(false)

  useEffect(() => {
    const id = globalThis.setTimeout(() => setDndReady(true), 0)
    return () => globalThis.clearTimeout(id)
  }, [])

  function submit() {
    const trimmed = draft.trim()
    if (!trimmed) return
    onCreate({ name: trimmed, color: withColor ? draftColor : undefined })
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const fromIndex = result.source.index
    const toIndex = result.destination.index
    if (fromIndex === toIndex) return
    const moved = items[fromIndex]
    if (!moved) return
    const remaining = items.filter((_, i) => i !== fromIndex)
    const before = remaining[toIndex - 1] ?? null
    const after = remaining[toIndex] ?? null
    onReorder(moved.id, before?.id ?? null, after?.id ?? null)
  }

  return (
    <Box sx={{ p: 1.5, minWidth: 280, maxWidth: 320 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 1, fontWeight: 600 }}
      >
        {title}
      </Typography>

      <Stack spacing={1} sx={{ mb: 1.5 }}>
        <TextField
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={addPlaceholder}
          size="small"
          fullWidth
          InputProps={{
            endAdornment: (
              <IconButton
                aria-label="Добавить"
                size="small"
                onClick={submit}
                disabled={!draft.trim()}
                edge="end"
              >
                <AddIcon fontSize="small" />
              </IconButton>
            ),
          }}
        />
        {withColor ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ rowGap: 0.5 }}>
            {KANBAN_LABEL_COLORS.map((c) => (
              <Box
                key={c.hex}
                role="button"
                aria-label={`Цвет ${c.name}`}
                aria-pressed={draftColor === c.hex}
                onClick={() => setDraftColor(c.hex)}
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: 0.75,
                  bgcolor: c.hex,
                  cursor: 'pointer',
                  border: 2,
                  borderColor: draftColor === c.hex ? 'primary.main' : 'transparent',
                  transition: 'border-color 120ms',
                }}
              />
            ))}
          </Stack>
        ) : null}
      </Stack>

      {renderList()}
    </Box>
  )

  function renderList() {
    if (items.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          Список пуст
        </Typography>
      )
    }
    if (!dndReady) {
      return (
        <Stack spacing={0.25} sx={{ maxHeight: 280, overflowY: 'auto' }}>
          {items.map((item) => (
            <ListRow
              key={item.id}
              item={item}
              mode={mode}
              selected={selectedIds.includes(item.id)}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))}
        </Stack>
      )
    }
    return (
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="manage-list">{renderDroppable}</Droppable>
      </DragDropContext>
    )
  }

  function renderDroppable(provided: Parameters<Parameters<typeof Droppable>[0]['children']>[0]) {
    return (
      <Stack
        ref={provided.innerRef}
        {...provided.droppableProps}
        spacing={0.25}
        sx={{ maxHeight: 280, overflowY: 'auto' }}
      >
        {items.map((item, index) => renderDraggable(item, index))}
        {provided.placeholder}
      </Stack>
    )
  }

  function renderDraggable(item: ManageListItem, index: number) {
    return (
      <Draggable key={item.id} draggableId={item.id} index={index}>
        {(dp) => (
          <ListRow
            item={item}
            mode={mode}
            selected={selectedIds.includes(item.id)}
            onToggle={onToggle}
            onDelete={onDelete}
            rowRef={dp.innerRef}
            draggableProps={dp.draggableProps}
            dragHandleProps={dp.dragHandleProps}
          />
        )}
      </Draggable>
    )
  }
}

interface ListRowProps {
  readonly item: ManageListItem
  readonly mode: ManageListMode
  readonly selected: boolean
  readonly onToggle: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly rowRef?: (el: HTMLElement | null) => void
  readonly draggableProps?: DraggableProvidedDraggableProps
  readonly dragHandleProps?: DraggableProvidedDragHandleProps | null
}

function ListRow({
  item,
  mode,
  selected,
  onToggle,
  onDelete,
  rowRef,
  draggableProps,
  dragHandleProps,
}: ListRowProps) {
  const handleStyle = {
    display: 'flex',
    alignItems: 'center',
    color: 'text.disabled',
    cursor: dragHandleProps ? 'grab' : 'default',
    '&:active': { cursor: dragHandleProps ? 'grabbing' : 'default' },
  }
  const dragHandle: ReactNode = dragHandleProps ? (
    <Box {...dragHandleProps} sx={handleStyle}>
      <DragIndicatorIcon fontSize="small" />
    </Box>
  ) : (
    <Box sx={handleStyle}>
      <DragIndicatorIcon fontSize="small" />
    </Box>
  )
  return (
    <Stack
      ref={rowRef}
      {...(draggableProps ?? {})}
      direction="row"
      alignItems="center"
      spacing={0.5}
      sx={{
        px: 0.5,
        py: 0.25,
        borderRadius: 1,
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {dragHandle}
      {mode === 'multi' ? (
        <Checkbox
          checked={selected}
          size="small"
          onChange={() => onToggle(item.id)}
          sx={{ p: 0.5 }}
        />
      ) : (
        <Radio
          checked={selected}
          size="small"
          onChange={() => onToggle(item.id)}
          sx={{ p: 0.5 }}
        />
      )}
      {item.color ? (
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            bgcolor: item.color,
            flexShrink: 0,
          }}
        />
      ) : null}
      <Box
        onClick={() => onToggle(item.id)}
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 14,
          cursor: 'pointer',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.label}
      </Box>
      <IconButton aria-label="Удалить" size="small" onClick={() => onDelete(item.id)}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}
