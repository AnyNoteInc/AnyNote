'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import type { Editor } from '@tiptap/core'

import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import FormatPaintOutlinedIcon from '@mui/icons-material/FormatPaintOutlined'
import ShortcutIcon from '@mui/icons-material/Shortcut'
import SyncAltOutlinedIcon from '@mui/icons-material/SyncAltOutlined'

import { blockDisplayName, isConvertible } from '../lib/block-names'
import {
  convertBlock,
  CONVERSION_ICONS,
  CONVERSION_LABELS,
  type ConversionTarget,
} from '../lib/block-conversion'
import { duplicateBlock } from '../lib/block-duplicate'
import {
  BACKGROUND_COLOR_KEYS,
  BACKGROUND_COLOR_LABELS,
  TEXT_COLOR_KEYS,
  TEXT_COLOR_LABELS,
  backgroundColorSwatch,
  textColorSwatch,
  type BackgroundColorKey,
  type TextColorKey,
} from '../lib/color-palette'

type Props = {
  editor: Editor
  anchorEl: HTMLElement | null
  pos: number | null
  onClose: () => void
  onRequestMove: (pos: number) => void
}

type Submenu = 'convert' | 'color' | null

export function DragHandleMenu({ editor, anchorEl, pos, onClose, onRequestMove }: Props) {
  const [submenu, setSubmenu] = useState<Submenu>(null)
  const [submenuAnchor, setSubmenuAnchor] = useState<HTMLElement | null>(null)

  const node = useMemo(
    () => (pos == null ? null : (editor.state.doc.resolve(pos).nodeAfter ?? null)),
    [editor, pos],
  )
  const displayName = node ? blockDisplayName(node) : ''
  const convertible = node ? isConvertible(node) : false

  const handleClose = () => {
    setSubmenu(null)
    setSubmenuAnchor(null)
    onClose()
  }

  const handleOpenSubmenu = (kind: 'convert' | 'color') => (e: MouseEvent<HTMLElement>) => {
    setSubmenu(kind)
    setSubmenuAnchor(e.currentTarget)
  }

  const handleConvert = (target: ConversionTarget) => {
    if (pos == null) return
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .run()
    convertBlock(editor, target)
    handleClose()
  }

  const handleTextColor = (color: TextColorKey) => {
    if (pos == null || !node) return
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 })
      .run()
    editor.chain().focus().setAnynoteTextColor(color).run()
    handleClose()
  }

  const handleBackground = (color: BackgroundColorKey) => {
    if (pos == null || !node) return
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 })
      .run()
    editor.chain().focus().setBlockBackground(color).run()
    handleClose()
  }

  const handleDuplicate = () => {
    if (pos == null) return
    duplicateBlock(editor, pos)
    handleClose()
  }

  const handleDelete = () => {
    if (pos == null || !node) return
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
    handleClose()
  }

  const handleMove = () => {
    if (pos == null) return
    onRequestMove(pos)
    handleClose()
  }

  return (
    <>
      <Menu
        open={Boolean(anchorEl && pos != null)}
        anchorEl={anchorEl}
        onClose={handleClose}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        <MenuItem disabled dense>
          <Typography variant="caption" color="text.secondary">
            {displayName}
          </Typography>
        </MenuItem>

        {convertible && (
          <MenuItem onClick={handleOpenSubmenu('convert')}>
            <ListItemIcon>
              <SyncAltOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Превратить в</ListItemText>
            <Typography variant="caption" color="text.secondary">
              ▸
            </Typography>
          </MenuItem>
        )}

        <MenuItem onClick={handleOpenSubmenu('color')}>
          <ListItemIcon>
            <FormatPaintOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Цвет</ListItemText>
          <Typography variant="caption" color="text.secondary">
            ▸
          </Typography>
        </MenuItem>

        <Divider />

        <MenuItem onClick={handleDuplicate}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Дубликат</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleMove}>
          <ListItemIcon>
            <ShortcutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Переместить</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          <ListItemText>Удалить</ListItemText>
        </MenuItem>
      </Menu>

      <Menu
        open={submenu === 'convert' && Boolean(submenuAnchor)}
        anchorEl={submenuAnchor}
        onClose={() => setSubmenu(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {(Object.keys(CONVERSION_LABELS) as ConversionTarget[]).map((target) => {
          const Icon = CONVERSION_ICONS[target]
          return (
            <MenuItem key={target} onClick={() => handleConvert(target)} sx={denseMenuItemSx}>
              <ListItemIcon sx={{ minWidth: 24 }}>
                <Icon width={16} height={16} />
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: 13 }}>
                {CONVERSION_LABELS[target]}
              </ListItemText>
            </MenuItem>
          )
        })}
      </Menu>

      <Menu
        open={submenu === 'color' && Boolean(submenuAnchor)}
        anchorEl={submenuAnchor}
        onClose={() => setSubmenu(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { minWidth: 160 } } }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', px: 1.25, pt: 0.5 }}
        >
          Цвет текста
        </Typography>
        {TEXT_COLOR_KEYS.map((key) => (
          <MenuItem key={`t-${key}`} onClick={() => handleTextColor(key)} sx={compactColorItemSx}>
            <Swatch color={textColorSwatch(key)} />
            <span>{TEXT_COLOR_LABELS[key]}</span>
          </MenuItem>
        ))}
        <Divider sx={{ my: 0.25 }} />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', px: 1.25, pt: 0.5 }}
        >
          Фон
        </Typography>
        {BACKGROUND_COLOR_KEYS.map((key) => (
          <MenuItem key={`b-${key}`} onClick={() => handleBackground(key)} sx={compactColorItemSx}>
            <Swatch color={backgroundColorSwatch(key)} />
            <span>{BACKGROUND_COLOR_LABELS[key]}</span>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

const denseMenuItemSx = { py: 0.5 } as const

const compactColorItemSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  fontSize: 13,
  py: 0.5,
  px: 1.25,
  minHeight: 28,
} as const

function Swatch({ color }: { color: string }) {
  return (
    <Box
      sx={{
        width: 14,
        height: 14,
        borderRadius: 0.5,
        border: '1px solid',
        borderColor: 'divider',
        backgroundColor: color === 'transparent' ? 'transparent' : color,
        flexShrink: 0,
      }}
    />
  )
}
