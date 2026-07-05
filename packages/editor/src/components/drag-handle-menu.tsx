'use client'

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Editor } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'

import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ControlPointDuplicateIcon from '@mui/icons-material/ControlPointDuplicate'
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
import { blockToMarkdown } from '../lib/block-to-markdown'
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

function taskItemDeleteRange(
  $pos: ResolvedPos,
  pos: number,
  nodeName: string,
): { from: number; to: number } | null {
  if (nodeName === 'taskItem' && $pos.parent.type.name === 'taskList') {
    if ($pos.parent.childCount === 1) {
      const from = $pos.before($pos.depth)
      return { from, to: from + $pos.parent.nodeSize }
    }

    const node = $pos.nodeAfter
    return node ? { from: pos, to: pos + node.nodeSize } : null
  }

  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (node.type.name !== 'taskItem') continue

    const parent = depth > 0 ? $pos.node(depth - 1) : null
    if (parent?.type.name === 'taskList' && parent.childCount === 1) {
      const from = $pos.before(depth - 1)
      return { from, to: from + parent.nodeSize }
    }

    const from = $pos.before(depth)
    return { from, to: from + node.nodeSize }
  }

  return null
}

export function DragHandleMenu({ editor, anchorEl, pos, onClose, onRequestMove }: Props) {
  const [submenu, setSubmenu] = useState<Submenu>(null)
  const [submenuAnchor, setSubmenuAnchor] = useState<HTMLElement | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current)
    },
    [],
  )

  const node = useMemo(
    () => (pos == null ? null : (editor.state.doc.resolve(pos).nodeAfter ?? null)),
    [editor, pos],
  )
  const displayName = node ? blockDisplayName(node) : ''
  const convertible = node ? isConvertible(node) : false

  const handleClose = () => {
    if (copyTimerRef.current != null) {
      window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = null
    }
    setCopied(false)
    setSubmenu(null)
    setSubmenuAnchor(null)
    onClose()
  }

  const handleOpenSubmenu = (kind: 'convert' | 'color') => (e: MouseEvent<HTMLElement>) => {
    setSubmenu(kind)
    setSubmenuAnchor(e.currentTarget)
  }

  const handleCopyText = () => {
    if (!node || copied) return
    const markdown = blockToMarkdown(editor.schema, node)
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard?.writeText) {
      // Insecure context (plain HTTP) — nothing to flash, just close.
      handleClose()
      return
    }
    void clipboard
      .writeText(markdown)
      .then(() => {
        setCopied(true)
        copyTimerRef.current = window.setTimeout(handleClose, 900)
      })
      .catch(() => handleClose())
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
    const taskItemRange = taskItemDeleteRange(editor.state.doc.resolve(pos), pos, node.type.name)
    const range = taskItemRange ?? { from: pos, to: pos + node.nodeSize }

    editor
      .chain()
      .focus()
      .deleteRange(range)
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

        <MenuItem onClick={handleCopyText} data-testid="block-copy-text">
          <ListItemIcon>
            {copied ? (
              <CheckIcon fontSize="small" color="success" />
            ) : (
              <ContentCopyIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>{copied ? 'Скопировано' : 'Копировать текст'}</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleDuplicate}>
          <ListItemIcon>
            <ControlPointDuplicateIcon fontSize="small" />
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
