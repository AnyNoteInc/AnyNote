'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Box, IconButton, InputBase, OpenInFullIcon } from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { useOptimisticRows } from './use-view-rows'

interface RowTitleCellProps {
  readonly pageId: string
  /** The active view whose listRows cache the optimistic title patch targets. */
  readonly viewId: string | undefined
  readonly rowId: string
  readonly title: string | null
  readonly editable?: boolean
}

/**
 * The system Title column. Edits write `Page.title` via `database.updateRow`
 * (optimistic on the listRows cache). An open affordance sets `?rowId=` in the
 * URL; the item-page modal (Phase D) reads that param. The Title column is never
 * deletable/renamable — it is the page title, not a DatabaseProperty.
 */
export function RowTitleCell({ pageId, viewId, rowId, title, editable = true }: RowTitleCellProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { patchTitle, invalidateActive } = useOptimisticRows(pageId, viewId)
  const [draft, setDraft] = useState(() => title ?? '')

  useEffect(() => {
    setDraft(title ?? '')
  }, [title])

  const updateRow = trpc.database.updateRow.useMutation({
    onError: () => invalidateActive(),
  })

  function persist() {
    const next = draft.trim()
    if (next === (title ?? '')) return
    patchTitle(rowId, next)
    updateRow.mutate({ pageId, rowId, title: next })
  }

  function open() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('rowId', rowId)
    router.replace(`?${params.toString()}`)
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, '&:hover .row-open': { opacity: 1 } }}>
      <InputBase
        value={draft}
        placeholder="Без названия"
        readOnly={!editable}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={persist}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            setDraft(title ?? '')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        fullWidth
        sx={{ fontSize: 14, fontWeight: 500, px: 0.5 }}
      />
      <IconButton
        className="row-open"
        size="small"
        onClick={open}
        sx={{ opacity: 0, transition: 'opacity 0.15s' }}
        aria-label="Открыть строку"
      >
        <OpenInFullIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
