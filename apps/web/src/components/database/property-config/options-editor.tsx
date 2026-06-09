'use client'

import { useState } from 'react'
import {
  AddIcon,
  ArrowDownwardIcon,
  ArrowUpwardIcon,
  Box,
  Button,
  DeleteIcon,
  IconButton,
  Menu,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import type { SelectOption } from '../types'

interface OptionsEditorProps {
  readonly options: SelectOption[]
  readonly onChange: (next: SelectOption[]) => void
  readonly disabled?: boolean
}

// A compact palette of distinct option colours (Tailwind-ish swatches). Matches the
// hex strings the toolbar seeds for SELECT/STATUS so existing options stay coherent.
const OPTION_COLORS: readonly string[] = [
  '#9CA3AF', // gray
  '#EF4444', // red
  '#F59E0B', // amber
  '#10B981', // emerald
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#84CC16', // lime
]

function makeOptionId(): string {
  // crypto.randomUUID is available in every browser the app targets; the fallback
  // keeps SSR/old-runtime paths from crashing (these ids are opaque to the server).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `opt-${crypto.randomUUID()}`
  }
  return `opt-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/**
 * Editor for SELECT/STATUS/MULTI_SELECT options (`settings.options`). Each option
 * has an editable label, a colour swatch (palette menu), and reorder/remove
 * controls. New options get a generated id + the next unused palette colour. The
 * parent persists the full array via `updateProperty({ settings: { options } })`.
 */
export function OptionsEditor({ options, onChange, disabled }: OptionsEditorProps) {
  const [colorAnchor, setColorAnchor] = useState<{ el: HTMLElement; index: number } | null>(null)

  function setLabel(index: number, label: string) {
    onChange(options.map((o, i) => (i === index ? { ...o, label } : o)))
  }

  function setColor(index: number, color: string) {
    onChange(options.map((o, i) => (i === index ? { ...o, color } : o)))
    setColorAnchor(null)
  }

  function remove(index: number) {
    onChange(options.filter((_, i) => i !== index))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= options.length) return
    const moved = options[index]
    if (!moved) return
    const next = options.filter((_, i) => i !== index)
    next.splice(target, 0, moved)
    onChange(next)
  }

  function add() {
    const used = new Set(options.map((o) => o.color))
    const color = OPTION_COLORS.find((c) => !used.has(c)) ?? OPTION_COLORS[0]
    onChange([...options, { id: makeOptionId(), label: `Вариант ${options.length + 1}`, color }])
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Варианты
      </Typography>
      <Stack spacing={1}>
        {options.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Пока нет вариантов. Добавьте первый.
          </Typography>
        ) : null}
        {options.map((option, index) => (
          <Stack key={option.id} direction="row" spacing={0.5} alignItems="center">
            <IconButton
              size="small"
              aria-label="Цвет варианта"
              disabled={disabled}
              onClick={(e) => setColorAnchor({ el: e.currentTarget, index })}
              sx={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                bgcolor: option.color ?? '#9CA3AF',
                border: 1,
                borderColor: 'divider',
                '&:hover': { bgcolor: option.color ?? '#9CA3AF', opacity: 0.85 },
              }}
            />
            <TextField
              size="small"
              value={option.label}
              disabled={disabled}
              onChange={(e) => setLabel(index, e.target.value)}
              fullWidth
              inputProps={{ 'aria-label': 'Название варианта' }}
            />
            <IconButton
              size="small"
              aria-label="Вверх"
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label="Вниз"
              disabled={disabled || index === options.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label="Удалить вариант"
              disabled={disabled}
              onClick={() => remove(index)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={add}
        disabled={disabled}
        sx={{ mt: 1 }}
      >
        Добавить вариант
      </Button>

      <Menu
        anchorEl={colorAnchor?.el ?? null}
        open={Boolean(colorAnchor)}
        onClose={() => setColorAnchor(null)}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, p: 1.5 }}>
          {OPTION_COLORS.map((color) => (
            <IconButton
              key={color}
              size="small"
              aria-label={`Цвет ${color}`}
              onClick={() => colorAnchor && setColor(colorAnchor.index, color)}
              sx={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                bgcolor: color,
                border: 2,
                borderColor:
                  colorAnchor && options[colorAnchor.index]?.color === color
                    ? 'primary.main'
                    : 'divider',
                '&:hover': { bgcolor: color, opacity: 0.85 },
              }}
            />
          ))}
        </Box>
      </Menu>
    </Box>
  )
}
