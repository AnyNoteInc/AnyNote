"use client"

import { List, ListItemButton, ListItemIcon, ListItemText, Paper } from "@mui/material"
import { forwardRef, useEffect, useImperativeHandle, useState } from "react"

import type { SlashCommandItem } from "../types"

export type SlashMenuPopoverHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

type Props = {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export const SlashMenuPopover = forwardRef<SlashMenuPopoverHandle, Props>(function SlashMenuPopover(
  { items, command },
  ref,
) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    setActive(0)
  }, [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (items.length === 0) return false
      if (event.key === "ArrowDown") {
        setActive((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === "ArrowUp") {
        setActive((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (event.key === "Enter") {
        const item = items[active]
        if (item) {
          command(item)
          return true
        }
      }
      return false
    },
  }))

  if (items.length === 0) return null

  return (
    <Paper elevation={6} sx={{ width: 260, py: 0.5, maxHeight: 320, overflow: "auto" }}>
      <List dense disablePadding>
        {items.map((item, idx) => (
          <ListItemButton
            key={item.id}
            selected={idx === active}
            onClick={() => command(item)}
            sx={{ gap: 1 }}
          >
            {item.icon ? (
              <ListItemIcon sx={{ minWidth: 28, color: "text.secondary" }}>
                {item.icon}
              </ListItemIcon>
            ) : null}
            <ListItemText primary={item.label} secondary={item.description} />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  )
})
