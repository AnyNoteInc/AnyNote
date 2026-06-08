'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Box,
  CircularProgress,
  CloseIcon,
  Dialog,
  Divider,
  IconButton,
  InputBase,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { useSession } from '@/lib/auth-client'
import { PageView } from '@/components/page/page-view'

import { CellEditor } from './cell-editors/cell-dispatch'
import type { DatabaseRowView, DatabaseViewModel } from './types'

/*
 * MVP — item "peek" modal.
 *
 * A database row is a real AnyNote Page (parented to the DATABASE page). This
 * modal opens that page in a Notion-style peek: editable title + properties on
 * the right, the collaborative page editor (the same `PageView`/Yjs path used by
 * the /pages/[pageId] route) for the body on the left.
 *
 * Deferred for this phase (documented limitations):
 *  - A dedicated full-page route for an item page (`/pages/<itemPageId>` works by
 *    id, but the in-database UX is the modal/peek only).
 *  - Row/item comments. `PageView` carries the page comment integration, but
 *    surfacing a comments rail inside the peek is out of scope here.
 *  - Icon/cover editing — a placeholder affordance only.
 */

const COLORS = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f']

function colorFor(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]!
}

interface DatabaseItemModalProps {
  /** The DATABASE page id (the source's page) — NOT the item page. */
  readonly pageId: string
  /** The already-loaded source view-model, so we can resolve the row + properties. */
  readonly data: DatabaseViewModel
  readonly editable?: boolean
}

/**
 * URL-param driven (`?rowId=`). Mounted inside `DatabasePageRenderer`; renders
 * nothing until `?rowId=` matches a row in the loaded source. Closing removes the
 * `rowId` param (preserving any other params).
 */
export function DatabaseItemModal({ pageId, data, editable = true }: DatabaseItemModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rowId = searchParams?.get('rowId') ?? null

  const row = useMemo(
    () => (rowId ? (data.rows.find((r) => r.rowId === rowId) ?? null) : null),
    [data.rows, rowId],
  )

  function close() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('rowId')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : globalThis.location.pathname)
  }

  // No matching row (param absent or stale) → render nothing.
  if (!rowId || !row) return null

  return (
    <Dialog
      open
      onClose={close}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: { xs: '95vw', md: '90vw', lg: '85vw' },
          maxWidth: 1400,
          height: { xs: '95vh', md: '88vh' },
          borderRadius: 2,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <ItemModalContent
        pageId={pageId}
        data={data}
        row={row}
        editable={editable}
        onClose={close}
      />
    </Dialog>
  )
}

function ItemModalContent({
  pageId,
  data,
  row,
  editable,
  onClose,
}: {
  pageId: string
  data: DatabaseViewModel
  row: DatabaseRowView
  editable: boolean
  onClose: () => void
}) {
  const properties = useMemo(
    () => [...data.properties].sort((a, b) => a.position - b.position),
    [data.properties],
  )

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', minHeight: 48 }}
      >
        {/* Icon/cover are not editable yet — placeholder affordance only (MVP). */}
        <Box
          aria-hidden
          sx={{
            width: 28,
            height: 28,
            borderRadius: 1,
            bgcolor: 'action.hover',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flex: '0 0 auto',
          }}
        >
          {row.icon ?? '📄'}
        </Box>
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={onClose} aria-label="Закрыть" size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ flex: 1, minHeight: 0 }}>
        <Box
          sx={{
            flex: { xs: 'none', md: 2 },
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Box sx={{ px: { xs: 2, md: 4 }, pt: { xs: 2, md: 3 } }}>
            <ItemTitle pageId={pageId} row={row} editable={editable} />
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, px: { xs: 1, md: 2 }, pb: 2 }}>
            <ItemBody itemPageId={row.pageId} editable={editable} />
          </Box>
        </Box>

        <Box
          sx={{
            flex: { xs: 'none', md: 1 },
            minWidth: { md: 320 },
            borderLeft: { md: 1 },
            borderTop: { xs: 1, md: 0 },
            borderColor: 'divider',
            bgcolor: 'background.default',
            overflowY: 'auto',
            p: { xs: 2, md: 3 },
          }}
        >
          <Typography variant="overline" color="text.secondary">
            Свойства
          </Typography>
          <Divider sx={{ my: 1 }} />
          {properties.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              Нет свойств
            </Typography>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {properties.map((property) => (
                <Stack
                  key={property.id}
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ minHeight: 32 }}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ width: 120, flex: '0 0 auto' }}
                    noWrap
                    title={property.name}
                  >
                    {property.name}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {/* Same cell editors as the table — keyed on the database pageId so
                        edits patch the shared `getByPage` cache (table + modal stay in sync). */}
                    <CellEditor pageId={pageId} row={row} property={property} editable={editable} />
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
    </>
  )
}

/** Editable item title — writes `Page.title` via `database.updateRow`, optimistic. */
function ItemTitle({
  pageId,
  row,
  editable,
}: {
  pageId: string
  row: DatabaseRowView
  editable: boolean
}) {
  const utils = trpc.useUtils()
  const [draft, setDraft] = useState(() => row.title ?? '')

  useEffect(() => {
    setDraft(row.title ?? '')
  }, [row.title])

  const setData = utils.database.getByPage.setData as (
    input: { pageId: string },
    updater: (prev: DatabaseViewModel | undefined) => DatabaseViewModel | undefined,
  ) => void

  const updateRow = trpc.database.updateRow.useMutation({
    onError: () => utils.database.getByPage.invalidate({ pageId }),
  })

  function persist() {
    const next = draft.trim()
    if (next === (row.title ?? '')) return
    setData({ pageId }, (current) => {
      if (!current) return current
      return {
        ...current,
        rows: current.rows.map((r) => (r.rowId === row.rowId ? { ...r, title: next } : r)),
      }
    })
    updateRow.mutate({ pageId, rowId: row.rowId, title: next })
  }

  return (
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
          setDraft(row.title ?? '')
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      fullWidth
      sx={{ fontSize: 28, fontWeight: 700, '& input': { p: 0 } }}
    />
  )
}

/**
 * The item Page body. The item is a real Page, so we load its type/contentYjs via
 * `page.getById` and render the standard `PageView` (editor + comments providers +
 * the default `/api/yjs/token` flow). The current viewer's identity comes from the
 * client session — the editor needs `{ id, name, color }` for awareness cursors.
 */
function ItemBody({ itemPageId, editable }: { itemPageId: string; editable: boolean }) {
  const { data: session } = useSession()
  const { data: page, isLoading, error } = trpc.page.getById.useQuery(
    { id: itemPageId },
    { retry: false, staleTime: 0 },
  )

  if (isLoading || !session?.user) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !page) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="text.secondary" variant="body2">
          Не удалось открыть страницу элемента: {error?.message ?? 'неизвестная ошибка'}
        </Typography>
      </Box>
    )
  }

  const user = session.user as { id: string; firstName?: string; lastName?: string; email: string }
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email

  return (
    <Box sx={{ height: '100%', minHeight: 0, overflowY: 'auto' }}>
      <PageView
        workspaceId={page.workspaceId}
        page={{ id: page.id, type: page.type, contentYjs: page.contentYjs }}
        user={{ id: user.id, name: displayName, color: colorFor(user.id) }}
        editable={editable}
      />
    </Box>
  )
}
