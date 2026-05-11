'use client'

import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'

import { ReminderSchema } from './reminder.schema'
import { computeReminderState } from './reminder/state'
import { REMINDER_COLORS } from './reminder/colors'
import { REMINDER_CHIP_SX, REMINDER_WRAPPER_STYLE } from './reminder/layout'

function useTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function formatRelative(iso: string, now: Date): string {
  if (!iso) return 'Установить дату'
  const due = new Date(iso)
  const diff = due.getTime() - now.getTime()
  const minutes = Math.round(diff / 60_000)
  const absMinutes = Math.abs(minutes)
  if (absMinutes < 60) return minutes >= 0 ? `через ${absMinutes} мин` : `${absMinutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24)
    return hours >= 0 ? `через ${Math.abs(hours)} ч` : `${Math.abs(hours)} ч назад`
  return due.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

function ReminderView({ node, editor }: NodeViewProps) {
  const now = useTick(60_000)
  const state = useMemo(
    () =>
      computeReminderState(
        {
          dueAt: node.attrs.dueAt,
          offsets: node.attrs.offsets,
          doneAt: node.attrs.doneAt,
        },
        now,
      ),
    [node.attrs.dueAt, node.attrs.offsets, node.attrs.doneAt, now],
  )
  const palette = REMINDER_COLORS[state]
  const isPlaceholder = !node.attrs.dueAt

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!editor.isEditable) return
    const ctx = editor.storage as {
      reminderCallbacks?: { onClick?: (id: string, anchor: HTMLElement) => void }
    }
    ctx.reminderCallbacks?.onClick?.(node.attrs.id, e.currentTarget)
  }

  return (
    <NodeViewWrapper
      as="span"
      data-id={`reminder-${node.attrs.id}`}
      contentEditable={false}
      style={REMINDER_WRAPPER_STYLE}
    >
      <Box
        component="span"
        onClick={handleClick}
        sx={{
          ...REMINDER_CHIP_SX,
          bgcolor: palette.bg,
          color: palette.fg,
          border: `1px solid ${palette.border}`,
          cursor: editor.isEditable ? 'pointer' : 'default',
          fontSize: '0.875em',
          lineHeight: 1.2,
          textDecoration: node.attrs.doneAt ? 'line-through' : 'none',
          fontStyle: isPlaceholder ? 'italic' : 'normal',
          userSelect: 'none',
          verticalAlign: 'baseline',
        }}
      >
        <NotificationsIcon sx={{ fontSize: '0.95em' }} />
        <span>{node.attrs.label || 'Напомнить'}</span>
        {!isPlaceholder && <span aria-hidden>·</span>}
        <span>{formatRelative(node.attrs.dueAt, now)}</span>
      </Box>
    </NodeViewWrapper>
  )
}

export const Reminder = ReminderSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ReminderView)
  },
})
