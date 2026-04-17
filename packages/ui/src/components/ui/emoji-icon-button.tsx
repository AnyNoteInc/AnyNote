"use client"

import { useState, type MouseEvent, type ReactNode } from "react"
import Box from "@mui/material/Box"
import IconButton, { type IconButtonProps } from "@mui/material/IconButton"
import Popover from "@mui/material/Popover"

import { EmojiPicker } from "./emoji-picker"

export type EmojiIconButtonProps = Omit<
  IconButtonProps,
  "children" | "onClick" | "onChange" | "value"
> & {
  value?: string | null
  onChange: (emoji: string) => void
  fallback?: ReactNode
  emojiSize?: number
}

export function EmojiIconButton({
  value,
  onChange,
  fallback = "📄",
  emojiSize = 32,
  sx,
  ...buttonProps
}: EmojiIconButtonProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = (event: MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget)
  const close = () => setAnchor(null)
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
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <EmojiPicker
          onSelect={(emoji) => {
            close()
            onChange(emoji)
          }}
        />
      </Popover>
    </>
  )
}
