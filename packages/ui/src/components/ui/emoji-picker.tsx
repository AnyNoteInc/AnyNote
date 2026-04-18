"use client"

import Picker, { EmojiStyle, Theme as EmojiTheme, type EmojiClickData } from "emoji-picker-react"
import { useTheme } from "@mui/material/styles"

export type EmojiPickerProps = {
  onSelect: (emoji: string) => void
  width?: number | string
  height?: number | string
}

export function EmojiPicker({ onSelect, width = 320, height = 400 }: EmojiPickerProps) {
  const muiTheme = useTheme()
  const theme = muiTheme.palette.mode === "dark" ? EmojiTheme.DARK : EmojiTheme.LIGHT
  return (
    <Picker
      onEmojiClick={(data: EmojiClickData) => onSelect(data.emoji)}
      theme={theme}
      emojiStyle={EmojiStyle.NATIVE}
      width={width}
      height={height}
      lazyLoadEmojis
      previewConfig={{ showPreview: false }}
    />
  )
}
