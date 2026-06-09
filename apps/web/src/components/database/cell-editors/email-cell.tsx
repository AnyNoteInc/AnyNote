'use client'

import { useEffect, useState } from 'react'
import { Box, EmailIcon, IconButton, InputBase, Tooltip } from '@repo/ui/components'

import { useCellUpdate } from './use-optimistic-cell'

interface EmailCellProps {
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(raw: string): boolean {
  return raw === '' || EMAIL_RE.test(raw)
}

/** Email cell — validated text input with a mailto: affordance. */
export function EmailCell({ pageId, rowId, propertyId, value, editable = true }: EmailCellProps) {
  const { commit } = useCellUpdate(pageId)
  const [draft, setDraft] = useState(() => toText(value))

  useEffect(() => {
    setDraft(toText(value))
  }, [value])

  const valid = isValidEmail(draft.trim())
  const current = toText(value).trim()

  function persist() {
    const next = draft.trim()
    if (next === current) return
    if (!isValidEmail(next)) {
      setDraft(toText(value))
      return
    }
    commit(rowId, propertyId, next === '' ? null : next)
  }

  if (!editable) {
    return current ? (
      <a
        href={`mailto:${current}`}
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
        placeholder="name@example.com"
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
        <Tooltip title="Написать">
          <IconButton
            size="small"
            component="a"
            href={`mailto:${current}`}
            onClick={(e) => e.stopPropagation()}
          >
            <EmailIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  )
}
