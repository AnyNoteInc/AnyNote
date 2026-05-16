'use client'

import { useState, type KeyboardEvent } from 'react'
import {
  AddIcon,
  Box,
  Checkbox,
  DeleteIcon,
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

const LIST_MAX_HEIGHT = 280
const ROW_HEIGHT = 34
const ROW_OVERSCAN = 6

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
}

export function ManageListPopover(props: ManageListPopoverProps) {
  const { open, anchorEl, onClose } = props
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transitionDuration={0}
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
}: ManageListPopoverProps) {
  const [draft, setDraft] = useState('')
  const [draftColor, setDraftColor] = useState<string>(
    KANBAN_LABEL_COLORS[0]?.hex ?? '#6B7280',
  )

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
    return (
      <VirtualizedRows
        items={items}
        mode={mode}
        selectedIds={selectedIds}
        onToggle={onToggle}
        onDelete={onDelete}
      />
    )
  }
}

interface VirtualizedRowsProps {
  readonly items: ReadonlyArray<ManageListItem>
  readonly mode: ManageListMode
  readonly selectedIds: ReadonlyArray<string>
  readonly onToggle: (id: string) => void
  readonly onDelete: (id: string) => void
}

function VirtualizedRows({
  items,
  mode,
  selectedIds,
  onToggle,
  onDelete,
}: VirtualizedRowsProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const viewportHeight = Math.min(LIST_MAX_HEIGHT, items.length * ROW_HEIGHT)
  const firstIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_OVERSCAN)
  const lastIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + ROW_OVERSCAN,
  )
  const visibleItems = items.slice(firstIndex, lastIndex)

  return (
    <Box
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      sx={{ height: viewportHeight, maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' }}
    >
      <Box sx={{ height: items.length * ROW_HEIGHT, position: 'relative' }}>
        {visibleItems.map((item, offset) => (
          <ListRow
            key={item.id}
            item={item}
            mode={mode}
            selected={selectedIds.includes(item.id)}
            onToggle={onToggle}
            onDelete={onDelete}
            top={(firstIndex + offset) * ROW_HEIGHT}
            height={ROW_HEIGHT}
          />
        ))}
      </Box>
    </Box>
  )
}

interface ListRowProps {
  readonly item: ManageListItem
  readonly mode: ManageListMode
  readonly selected: boolean
  readonly onToggle: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly top?: number
  readonly height?: number
}

function ListRow({
  item,
  mode,
  selected,
  onToggle,
  onDelete,
  top,
  height,
}: ListRowProps) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.5}
      sx={{
        ...(top !== undefined ? { position: 'absolute', top, left: 0, right: 0 } : {}),
        ...(height !== undefined ? { height } : {}),
        px: 0.5,
        py: 0.25,
        borderRadius: 1,
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
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
