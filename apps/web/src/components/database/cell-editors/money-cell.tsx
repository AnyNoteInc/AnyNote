'use client'

import { useState } from 'react'
import { InputBase } from '@repo/ui/components'

import { formatKopecks, kopecksToRubleText, parseRubleTextToKopecks } from '../money'
import { useCellUpdate } from './use-optimistic-cell'

interface MoneyCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

/**
 * Inline money cell. The stored cell value is an INTEGER count of kopecks (the
 * server rejects fractions); the editor converts to/from rubles so the user
 * types "123,45" and the cell displays "123,45 ₽". The raw ruble draft is only
 * visible while focused, so it is seeded on focus rather than mirrored from
 * `value` on every change.
 */
export function MoneyCell({ pageId, rowId, propertyId, value, editable = true }: MoneyCellProps) {
  const { commit } = useCellUpdate(pageId)
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)

  const formatted =
    typeof value === 'number' && Number.isFinite(value) ? formatKopecks(value) : ''

  function persist() {
    setFocused(false)
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value != null) commit(rowId, propertyId, null)
      return
    }
    const kopecks = parseRubleTextToKopecks(trimmed)
    if (kopecks === null || kopecks === value) return
    commit(rowId, propertyId, kopecks)
  }

  if (!editable) {
    return <span style={{ fontSize: 14 }}>{formatted}</span>
  }

  return (
    <InputBase
      // Show the formatted currency at rest and the raw ruble number while editing.
      value={focused ? draft : formatted}
      inputMode="decimal"
      onFocus={() => {
        setFocused(true)
        setDraft(kopecksToRubleText(value))
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={persist}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        }
        if (e.key === 'Escape') {
          // Cancel: restore the original draft so the blur-persist is a no-op.
          setDraft(kopecksToRubleText(value))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      fullWidth
      sx={{ fontSize: 14, px: 0.5 }}
    />
  )
}
