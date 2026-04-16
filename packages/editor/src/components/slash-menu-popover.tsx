"use client"

import { List, ListItemButton, ListItemText, Paper } from "@mui/material"
import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import type { CSSProperties } from "react"

import type { SlashCommandItem } from "../types.js"

export type SlashMenuPopoverHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

type Props = {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  clientRect?: (() => DOMRect | null) | null
}

export const SlashMenuPopover = forwardRef<SlashMenuPopoverHandle, Props>(
  function SlashMenuPopover({ items, command, clientRect }, ref) {
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

    const rect = clientRect?.()
    const style: CSSProperties = rect
      ? { position: "fixed", top: rect.bottom + 4, left: rect.left, zIndex: 1300 }
      : { display: "none" }

    return (
      <Paper elevation={6} style={style} sx={{ width: 280, py: 0.5 }}>
        <List dense>
          {items.map((item, idx) => (
            <ListItemButton
              key={item.id}
              selected={idx === active}
              onClick={() => command(item)}
            >
              <ListItemText primary={item.label} secondary={item.description} />
            </ListItemButton>
          ))}
        </List>
      </Paper>
    )
  },
)
