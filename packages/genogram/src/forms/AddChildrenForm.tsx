import { useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'
import type { ChildEntryDraft } from '../yjs/actions'
import type { ChildEntry } from '../types/domain'
import { ChildEntryRow } from './ChildEntryRow'
import { RU } from '../i18n/ru'

interface ExistingChildView {
  entry: ChildEntry
  label: string
}

interface Props {
  existingChildren: ExistingChildView[]
  initialCount?: number
  onSubmit: (newEntries: ChildEntryDraft[], reorderExisting?: ChildEntry[]) => void
  onCancel: () => void
}

export function AddChildrenForm({ existingChildren, initialCount, onSubmit, onCancel }: Props) {
  const K = existingChildren.length
  const [count, setCount] = useState<number>(initialCount ?? Math.max(K + 1, 1))
  const [orderedExisting, setOrderedExisting] = useState<ExistingChildView[]>(existingChildren)
  const [newEntries, setNewEntries] = useState<ChildEntryDraft[]>(() => {
    const need = Math.max(0, (initialCount ?? Math.max(K + 1, 1)) - K)
    return Array.from({ length: need }, () => ({
      type: 'person' as const,
      data: { sex: 'male' as const, lifeStatus: 'alive' as const, birthMode: 'date' as const },
    }))
  })

  const updateCount = (n: number) => {
    if (n < K) return
    setCount(n)
    setNewEntries((prev) => {
      const need = n - K
      if (need > prev.length) {
        return [
          ...prev,
          ...Array.from({ length: need - prev.length }, () => ({
            type: 'person' as const,
            data: { sex: 'male' as const, lifeStatus: 'alive' as const, birthMode: 'date' as const },
          })),
        ]
      }
      return prev.slice(0, need)
    })
  }

  const updateNew = (idx: number, next: ChildEntryDraft) =>
    setNewEntries((arr) => arr.map((e, i) => (i === idx ? next : e)))

  const move = (idx: number, dir: -1 | 1) => {
    setOrderedExisting((arr) => {
      const next = [...arr]
      const target = idx + dir
      if (target < 0 || target >= next.length) return next
      ;[next[idx], next[target]] = [next[target]!, next[idx]!]
      return next
    })
  }

  const submit = () => {
    const reordered = orderedExisting.map((x) => x.entry)
    const reorderChanged =
      JSON.stringify(reordered) !== JSON.stringify(existingChildren.map((x) => x.entry))
    onSubmit(newEntries, reorderChanged ? reordered : undefined)
  }

  return (
    <Stack spacing={2}>
      <TextField
        label={RU.fields.childCount}
        type="number"
        inputProps={{ min: K, inputMode: 'numeric' }}
        value={count}
        onChange={(e) => updateCount(Number(e.target.value))}
      />
      {orderedExisting.map((c, i) => (
        <Stack key={i} direction="row" alignItems="center" spacing={1}>
          <Button size="small" onClick={() => move(i, -1)} disabled={i === 0}>
            ↑
          </Button>
          <Button size="small" onClick={() => move(i, 1)} disabled={i === orderedExisting.length - 1}>
            ↓
          </Button>
          <span>{i + 1}.</span>
          <span>{c.label}</span>
        </Stack>
      ))}
      {newEntries.map((entry, i) => (
        <Stack key={`new-${i}`} spacing={1}>
          <span>{K + i + 1}.</span>
          <ChildEntryRow value={entry} onChange={(next) => updateNew(i, next)} />
        </Stack>
      ))}
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button variant="contained" onClick={submit}>
          {RU.drawer.save}
        </Button>
      </Stack>
    </Stack>
  )
}
