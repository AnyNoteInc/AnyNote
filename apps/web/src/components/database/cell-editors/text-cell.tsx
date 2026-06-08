'use client'

import { useEffect, useState } from 'react'
import { InputBase } from '@repo/ui/components'

import { useCellUpdate } from './use-optimistic-cell'

interface TextCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/** Inline text cell — commits on blur / Enter, reverts on Escape. */
export function TextCell({ pageId, rowId, propertyId, value, editable = true }: TextCellProps) {
  const { commit } = useCellUpdate(pageId)
  const [draft, setDraft] = useState(() => toText(value))

  // Re-sync when the upstream value changes (e.g. another client edited it).
  useEffect(() => {
    setDraft(toText(value))
  }, [value])

  function persist() {
    const next = draft.trim()
    if (next === toText(value)) return
    commit(rowId, propertyId, next === '' ? null : next)
  }

  if (!editable) {
    return <span style={{ fontSize: 14 }}>{toText(value)}</span>
  }

  return (
    <InputBase
      value={draft}
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
