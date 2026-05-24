'use client'

import { Avatar, List, ListItemAvatar, ListItemButton, ListItemText, Paper } from '@mui/material'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import type { MentionItem } from '../mentions'

export type MentionMenuPopoverHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

type Props = {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

export const MentionMenuPopover = forwardRef<MentionMenuPopoverHandle, Props>(
  function MentionMenuPopover({ items, command }, ref) {
    const [active, setActive] = useState(0)
    const itemRefs = useRef<(HTMLElement | null)[]>([])

    useEffect(() => {
      setActive(0)
    }, [items])

    useEffect(() => {
      itemRefs.current[active]?.scrollIntoView({ block: 'nearest' })
    }, [active])

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (items.length === 0) return false
        if (event.key === 'ArrowDown') {
          setActive((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          setActive((i) => (i - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[active]
          if (item) command(item)
          return true
        }
        return false
      },
    }))

    if (items.length === 0) return null

    return (
      <Paper elevation={6} sx={{ width: 280, py: 0.5, maxHeight: 320, overflow: 'auto' }}>
        <List dense disablePadding role="listbox" aria-label="Участники пространства">
          {items.map((item, index) => (
            <ListItemButton
              key={item.id}
              ref={(el: HTMLElement | null) => {
                itemRefs.current[index] = el
              }}
              selected={index === active}
              onClick={() => command(item)}
              role="option"
              aria-selected={index === active}
              aria-label={`${item.label}${item.email ? ` ${item.email}` : ''}`}
              sx={{ gap: 1 }}
            >
              <ListItemAvatar sx={{ minWidth: 36 }}>
                <Avatar sx={{ width: 24, height: 24, fontSize: 12 }}>
                  {item.label.slice(0, 1).toUpperCase()}
                </Avatar>
              </ListItemAvatar>
              <ListItemText primary={item.label} secondary={item.email} />
            </ListItemButton>
          ))}
        </List>
      </Paper>
    )
  },
)
