'use client'

import { useState, type MouseEvent, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton, { type IconButtonProps } from '@mui/material/IconButton'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'

import { EmojiPicker } from './emoji-picker'

export type EmojiIconButtonProps = Omit<
  IconButtonProps,
  'children' | 'onClick' | 'onChange' | 'value'
> & {
  value?: string | null
  onChange: (emoji: string) => void
  onRemove?: () => void
  fallback?: ReactNode
  emojiSize?: number
}

export function EmojiIconButton({
  value,
  onChange,
  onRemove,
  fallback = '📄',
  emojiSize = 32,
  sx,
  ...buttonProps
}: EmojiIconButtonProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = (event: MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget)
  const close = () => setAnchor(null)
  const canRemove = Boolean(value && onRemove)
  return (
    <>
      <IconButton {...buttonProps} onClick={open} sx={sx}>
        <Box component="span" sx={{ lineHeight: 1, fontSize: emojiSize }}>
          {value || fallback}
        </Box>
      </IconButton>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack>
          {canRemove ? (
            <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Button
                size="small"
                fullWidth
                color="inherit"
                startIcon={<DeleteOutlineIcon fontSize="small" />}
                onClick={() => {
                  close()
                  onRemove?.()
                }}
                sx={{ justifyContent: 'flex-start', color: 'text.secondary' }}
              >
                Удалить иконку
              </Button>
            </Box>
          ) : null}
          <EmojiPicker
            onSelect={(emoji) => {
              close()
              onChange(emoji)
            }}
          />
        </Stack>
      </Popover>
    </>
  )
}
