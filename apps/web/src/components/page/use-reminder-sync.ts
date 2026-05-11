'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { Editor } from '@repo/editor'

import { trpc } from '@/trpc/client'

type PMNode = {
  type: { name: string }
  attrs: Record<string, unknown>
}

export type DocLike = {
  descendants(visit: (node: PMNode) => void): void
}

export type ReminderSyncInput = {
  id: string
  dueAt: string
  offsets: number[]
  audience: 'ME' | 'WORKSPACE' | 'LIST'
  label: string | null
  recipients: string[]
  doneAt: string | null
}

export function collectReminderInputs(doc: DocLike): ReminderSyncInput[] {
  const out: ReminderSyncInput[] = []
  doc.descendants((node) => {
    if (node.type.name !== 'reminder') return
    const a = node.attrs as Record<string, unknown>
    if (typeof a.id !== 'string' || !a.id) return
    if (typeof a.dueAt !== 'string' || !a.dueAt) return
    out.push({
      id: a.id,
      dueAt: a.dueAt,
      offsets: Array.isArray(a.offsets) ? (a.offsets as number[]) : [],
      audience: (a.audience as ReminderSyncInput['audience']) ?? 'ME',
      label: typeof a.label === 'string' ? a.label : null,
      recipients: Array.isArray(a.recipients) ? (a.recipients as string[]) : [],
      doneAt: typeof a.doneAt === 'string' ? a.doneAt : null,
    })
  })
  return out
}

function serializeReminderInputs(reminders: ReminderSyncInput[]) {
  return JSON.stringify(reminders)
}

function debounce<T extends (...args: never[]) => unknown>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null
  const wrapped = (...args: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
  wrapped.cancel = () => {
    if (t) clearTimeout(t)
    t = null
  }
  return wrapped as T & { cancel: () => void }
}

export function useReminderSync(editor: Editor | null, pageId: string) {
  const sync = trpc.reminder.syncForPage.useMutation()
  const lastSnapshotRef = useRef<string | null>(null)

  useEffect(() => {
    lastSnapshotRef.current = editor
      ? serializeReminderInputs(collectReminderInputs(editor.state.doc))
      : null
  }, [editor, pageId])

  const debounced = useMemo(
    () =>
      debounce(() => {
        if (!editor) return
        if (!editor.isEditable) return
        const reminders = collectReminderInputs(editor.state.doc)
        const nextSnapshot = serializeReminderInputs(reminders)
        if (lastSnapshotRef.current === nextSnapshot) return
        lastSnapshotRef.current = nextSnapshot
        sync.mutate({ pageId, reminders })
      }, 1_000),
    [editor, pageId, sync],
  )

  useEffect(() => {
    if (!editor) return
    editor.on('update', debounced)
    return () => {
      editor.off('update', debounced)
      debounced.cancel()
    }
  }, [editor, debounced])
}
