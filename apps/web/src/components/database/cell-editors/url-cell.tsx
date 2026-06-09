'use client'

import { useEffect, useState } from 'react'
import { Box, IconButton, InputBase, OpenInNewIcon, Tooltip } from '@repo/ui/components'

import { useCellUpdate } from './use-optimistic-cell'

interface UrlCellProps {
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

/** Accept http(s):// URLs and bare domains (we prefix https:// for the link). */
function isValidUrl(raw: string): boolean {
  if (raw === '') return true
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const u = new URL(candidate)
    return Boolean(u.hostname) && u.hostname.includes('.')
  } catch {
    return false
  }
}

function hrefFor(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

/** URL cell — validated text input with an open-in-new-tab affordance. */
export function UrlCell({ pageId, rowId, propertyId, value, editable = true }: UrlCellProps) {
  const { commit } = useCellUpdate(pageId)
  const [draft, setDraft] = useState(() => toText(value))

  useEffect(() => {
    setDraft(toText(value))
  }, [value])

  const valid = isValidUrl(draft.trim())
  const current = toText(value).trim()

  function persist() {
    const next = draft.trim()
    if (next === current) return
    if (!isValidUrl(next)) {
      setDraft(toText(value))
      return
    }
    commit(rowId, propertyId, next === '' ? null : next)
  }

  if (!editable) {
    return current ? (
      <a
        href={hrefFor(current)}
        target="_blank"
        rel="noopener noreferrer"
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
        placeholder="https://…"
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
        <Tooltip title="Открыть">
          <IconButton
            size="small"
            component="a"
            href={hrefFor(current)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  )
}
