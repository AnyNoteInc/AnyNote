'use client'

import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Paper,
} from '@mui/material'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import type { SlashCommandGroup, SlashCommandItem } from '../types'

export type SlashMenuPopoverHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

type Props = {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

const GROUP_ORDER: SlashCommandGroup[] = ['base', 'code', 'media', 'embedding']

const GROUP_TITLES: Record<SlashCommandGroup, string> = {
  base: 'Базовые блоки',
  code: 'Код',
  media: 'Медиа',
  embedding: 'Встраиваемые',
}

export const SlashMenuPopover = forwardRef<SlashMenuPopoverHandle, Props>(function SlashMenuPopover(
  { items, command },
  ref,
) {
  const [active, setActive] = useState(0)

  const grouped = useMemo(() => {
    const byGroup = new Map<SlashCommandGroup, SlashCommandItem[]>()
    for (const item of items) {
      const list = byGroup.get(item.group) ?? []
      list.push(item)
      byGroup.set(item.group, list)
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      title: GROUP_TITLES[g],
      items: byGroup.get(g)!,
    }))
  }, [items])
  const orderedItems = useMemo(() => grouped.flatMap((group) => group.items), [grouped])

  useEffect(() => {
    setActive(0)
  }, [items])

  const itemRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const el = itemRefs.current[active]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [active])

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (orderedItems.length === 0) return false
      if (event.key === 'ArrowDown') {
        setActive((i) => (i + 1) % orderedItems.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setActive((i) => (i - 1 + orderedItems.length) % orderedItems.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = orderedItems[active]
        if (item) {
          command(item)
          return true
        }
      }
      return false
    },
  }))

  if (orderedItems.length === 0) return null

  let running = 0

  return (
    <Paper elevation={6} sx={{ width: 280, py: 0.5, maxHeight: 360, overflow: 'auto' }}>
      <List dense disablePadding subheader={<li />}>
        {grouped.map(({ group, title, items: groupItems }) => (
          <li key={group}>
            <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
              <ListSubheader
                disableSticky
                sx={{
                  lineHeight: '24px',
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: 'text.secondary',
                  backgroundColor: 'transparent',
                  px: 1.5,
                  pt: 0.75,
                }}
              >
                {title}
              </ListSubheader>
              {groupItems.map((item) => {
                const index = running++
                return (
                  <ListItemButton
                    key={item.id}
                    ref={(el: HTMLElement | null) => {
                      itemRefs.current[index] = el
                    }}
                    selected={index === active}
                    onClick={() => command(item)}
                    data-slash-item-id={item.id}
                    sx={{ gap: 1 }}
                  >
                    {item.icon ? (
                      <ListItemIcon sx={{ minWidth: 28, color: 'text.secondary' }}>
                        {item.icon}
                      </ListItemIcon>
                    ) : null}
                    <ListItemText primary={item.label} secondary={item.description} />
                  </ListItemButton>
                )
              })}
            </ul>
          </li>
        ))}
      </List>
    </Paper>
  )
})
