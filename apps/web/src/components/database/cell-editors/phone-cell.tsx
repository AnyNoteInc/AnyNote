'use client'

import { useEffect, useState } from 'react'
import { Box, IconButton, InputBase, LocalPhoneIcon, Tooltip } from '@repo/ui/components'

import { useCellUpdate } from './use-optimistic-cell'

interface PhoneCellProps {
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

// Permissive phone format: digits, spaces, +, -, (), at least 5 digits.
const PHONE_RE = /^[+]?[\d\s().-]{5,}$/

function isValidPhone(raw: string): boolean {
  if (raw === '') return true
  if (!PHONE_RE.test(raw)) return false
  return (raw.match(/\d/g)?.length ?? 0) >= 5
}

function telHref(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, '')}`
}

/** Phone cell — validated text input with a tel: affordance. */
export function PhoneCell({ pageId, rowId, propertyId, value, editable = true }: PhoneCellProps) {
  const { commit } = useCellUpdate(pageId)
  const [draft, setDraft] = useState(() => toText(value))

  useEffect(() => {
    setDraft(toText(value))
  }, [value])

  const valid = isValidPhone(draft.trim())
  const current = toText(value).trim()

  function persist() {
    const next = draft.trim()
    if (next === current) return
    if (!isValidPhone(next)) {
      setDraft(toText(value))
      return
    }
    commit(rowId, propertyId, next === '' ? null : next)
  }

  if (!editable) {
    return current ? (
      <a
        href={telHref(current)}
        style={{ fontSize: 14, color: 'var(--mui-palette-primary-main, #1976d2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {current}
      </a>
    ) : (
      <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>—</span>
    )
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
      <InputBase
        value={draft}
        placeholder="+7 900 000-00-00"
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
        error={!valid}
        fullWidth
        sx={{ fontSize: 14, px: 0.5, color: valid ? undefined : 'error.main' }}
      />
      {current && valid ? (
        <Tooltip title="Позвонить">
          <IconButton
            size="small"
            component="a"
            href={telHref(current)}
            onClick={(e) => e.stopPropagation()}
          >
            <LocalPhoneIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  )
}
