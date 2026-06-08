'use client'

import { useEffect, useState } from 'react'
import { InputBase } from '@repo/ui/components'

import { useCellUpdate } from './use-optimistic-cell'

interface NumberCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

function toText(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  return typeof value === 'number' ? String(value) : String(value)
}

/** Inline numeric cell — parses to a number, commits null when cleared. */
export function NumberCell({ pageId, rowId, propertyId, value, editable = true }: NumberCellProps) {
  const { commit } = useCellUpdate(pageId)
  const [draft, setDraft] = useState(() => toText(value))

  useEffect(() => {
    setDraft(toText(value))
  }, [value])

  function persist() {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value !== null && value !== undefined && value !== '') commit(rowId, propertyId, null)
      return
    }
    const parsed = Number(trimmed)
    if (Number.isNaN(parsed)) {
      setDraft(toText(value))
      return
    }
    if (parsed === value) return
    commit(rowId, propertyId, parsed)
  }

  if (!editable) {
    return <span style={{ fontSize: 14 }}>{toText(value)}</span>
  }

  return (
    <InputBase
      value={draft}
      type="number"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={persist}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        }
        if (e.key === 'Escape') {
          setDraft(toText(value))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      fullWidth
      sx={{ fontSize: 14, px: 0.5 }}
    />
  )
}
