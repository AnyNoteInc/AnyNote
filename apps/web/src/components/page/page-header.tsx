'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'

import type { Page } from '@repo/db'
import { AddIcon, Box, Button, IconButton, Stack, TextField, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PAGE_COLUMN_CLASS, pageColumnSx } from './column-sx'
import { CoverBand } from './cover-band'
import { CoverPicker } from './cover-picker'
import { IconPickerPopover } from './icon-picker-popover'
import { PageIcon } from './page-icon'

// Matches the scalar select used by page.listByWorkspace on the server. Kept
// local because pulling the tRPC router output type is exactly what triggered
// the TS2589 depth explosion we're sidestepping here.
type WorkspacePageListItem = {
  id: string
  title: string | null
  icon: string | null
  parentId: string | null
  prevPageId: string | null
  createdById: string
  createdAt: Date
}

const UNTITLED_PLACEHOLDER = 'Новая страница'

const ghostButtonSx = {
  color: 'text.secondary',
  textTransform: 'none',
  opacity: 0,
  transition: 'opacity .15s, color .15s, background-color .15s',
  // The parent header box flips opacity to 1 on hover to reveal these. Once
  // revealed the label must clearly contrast the page background in BOTH the
  // light and dark themes — bare text.secondary reads as a washed-out, near
  // invisible label (the reported "не видны" bug), so on direct hover/focus we
  // darken to text.primary and back it with an action.hover chip. Both colors
  // are palette tokens, so they stay legible in either theme.
  '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
  '&:focus-visible': { opacity: 1, color: 'text.primary', bgcolor: 'action.hover' },
} as const

const coverActionSx = {
  textTransform: 'none',
  bgcolor: 'background.paper',
  color: 'text.secondary',
  boxShadow: 1,
  px: 1,
  py: 0.25,
  minWidth: 0,
  fontSize: 12,
  '&:hover': { bgcolor: 'background.paper', color: 'text.primary' },
} as const

type Props = {
  id: string
  workspaceId: string
  initialTitle: string | null
  initialIcon: string | null
  initialCoverUrl?: string | null
  initialCoverPreset?: string | null
}

export function PageHeader({
  id,
  workspaceId,
  initialTitle,
  initialIcon,
  initialCoverUrl = null,
  initialCoverPreset = null,
}: Props) {
  const query = trpc.page.getById.useQuery({ id }, { staleTime: 0 })
  // Use the query result directly when loaded (data can be null for icon after
  // removal). Only fall back to SSR initialIcon/Title while the query is still
  // pending. `?? initialIcon` was a bug — it treated null as "not loaded".
  const title = query.data ? query.data.title : initialTitle
  const icon = query.data ? query.data.icon : initialIcon
  const coverUrl = query.data ? query.data.coverUrl : initialCoverUrl
  const coverPreset = query.data ? query.data.coverPreset : initialCoverPreset
  const hasCover = Boolean(coverUrl || coverPreset)

  const queryClient = useQueryClient()
  const update = trpc.page.update.useMutation({
    // Update both caches in place instead of invalidating. Invalidation would
    // refetch the whole workspace page list, which the sidebar + breadcrumb
    // subscribe to — causing a visible flicker and unnecessary network work.
    //
    // NB: uses queryClient.setQueryData + getQueryKey instead of
    // trpc.useUtils().page.*.setData. The tRPC utils wrapper's generic depth
    // (DecoratedProcedureUtilsRecord × Prisma v7 output types) exceeds TS's
    // recursion limit for the Page router — see TS2589. Routing through
    // TanStack Query directly uses a flat <TData> generic and type-checks fine.
    onSuccess: (updated, variables) => {
      const pageByIdKey = getQueryKey(trpc.page.getById, { id }, 'query')
      const currentPage = queryClient.getQueryData<Page>(pageByIdKey)
      // The mutation result carries no cover fields (RenameResultDto), so the
      // cover patch reads the INPUT. Cover mutations below always send BOTH
      // fields explicitly (mirroring the server's mutual exclusion), so the
      // pair below is the enforced final state, not a guess.
      const coverChanged = variables.coverUrl !== undefined || variables.coverPreset !== undefined
      if (currentPage) {
        // updatedAt is intentionally not written here: tRPC's default JSON
        // transport serialises Date → string, but Page's type says Date.
        // Skipping the field avoids a Date/string mismatch and the sidebar
        // will pick up the fresh timestamp from its own refetch path.
        queryClient.setQueryData<Page>(pageByIdKey, {
          ...currentPage,
          title: updated.title,
          icon: updated.icon,
          ...(coverChanged
            ? { coverUrl: variables.coverUrl ?? null, coverPreset: variables.coverPreset ?? null }
            : {}),
        })
      }
      const pageListKey = getQueryKey(trpc.page.listByWorkspace, { workspaceId }, 'query')
      const currentList = queryClient.getQueryData<WorkspacePageListItem[]>(pageListKey)
      if (currentList) {
        queryClient.setQueryData<WorkspacePageListItem[]>(
          pageListKey,
          currentList.map((p) =>
            p.id === id ? { ...p, title: updated.title, icon: updated.icon } : p,
          ),
        )
      }
    },
  })

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null)
  const [coverAnchor, setCoverAnchor] = useState<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setDraft(title ?? '')
    setEditing(true)
  }

  const commitEdit = () => {
    if (!editing) return
    setEditing(false)
    const current = (title ?? '').trim()
    const next = draft.trim()
    if (next !== current) update.mutate({ id, workspaceId, title: next })
  }

  const openIconPicker = (event: MouseEvent<HTMLElement>) => setIconAnchor(event.currentTarget)
  const openCoverPicker = (event: MouseEvent<HTMLElement>) => setCoverAnchor(event.currentTarget)

  return (
    <Box
      sx={{
        // Full content-area width. The cover (below) spans this whole width and
        // sits flush under the toolbar/breadcrumbs (no top padding). The title,
        // icon and add-buttons live inside the centred reading column.
        '&:hover .page-header__add-action': { opacity: 1 },
      }}
    >
      {hasCover ? (
        <CoverBand
          coverUrl={coverUrl}
          coverPreset={coverPreset}
          rounded={false}
          actions={
            <>
              <Button
                size="small"
                data-testid="page-cover-change"
                onClick={openCoverPicker}
                sx={coverActionSx}
              >
                Сменить обложку
              </Button>
              <Button
                size="small"
                data-testid="page-cover-remove"
                onClick={() =>
                  update.mutate({ id, workspaceId, coverUrl: null, coverPreset: null })
                }
                sx={coverActionSx}
              >
                Убрать обложку
              </Button>
            </>
          }
        />
      ) : null}
      <Stack
        className={PAGE_COLUMN_CLASS}
        spacing={0.5}
        sx={{
          ...pageColumnSx,
          // No cover → keep the original top breathing room; with a cover the
          // icon overlaps its bottom edge, so drop the top padding.
          pt: hasCover ? 1 : 4,
          pb: 1,
        }}
      >
        {!icon || !hasCover ? (
          <Box sx={{ height: 28, display: 'flex', gap: 0.5 }}>
            {!icon ? (
              <Button
                className="page-header__add-action"
                variant="text"
                size="small"
                data-testid="page-icon-add"
                onClick={openIconPicker}
                startIcon={<AddIcon fontSize="small" />}
                sx={ghostButtonSx}
              >
                Добавить иконку
              </Button>
            ) : null}
            {!hasCover ? (
              <Button
                className="page-header__add-action"
                variant="text"
                size="small"
                data-testid="page-cover-add"
                onClick={openCoverPicker}
                startIcon={<AddIcon fontSize="small" />}
                sx={ghostButtonSx}
              >
                Добавить обложку
              </Button>
            ) : null}
          </Box>
        ) : null}
        <Box sx={{ position: 'relative' }}>
          {icon ? (
            <IconButton
              aria-label="Изменить иконку"
              onClick={openIconPicker}
              sx={{
                position: 'absolute',
                // Hang the 56 px icon button into the left gutter so it sits to
                // the LEFT of the title without displacing it. -64 ≈ icon (56) +
                // ~8 px gap; keeps the icon's right edge just inside the 48 px
                // padding boundary.
                left: -64,
                // -36 pulls the icon up over the cover's bottom edge
                // (Notion-style overlap; matches the old flex layout's
                // mt:'-36px'). With no cover it sits flush with the title top.
                top: hasCover ? -36 : 0,
                width: 56,
                height: 56,
                p: 0.5,
                borderRadius: 1,
                zIndex: 1,
              }}
            >
              <PageIcon icon={icon} size={44} />
            </IconButton>
          ) : null}
          {editing ? (
            <TextField
              inputRef={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitEdit()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                }
              }}
              variant="standard"
              fullWidth
              placeholder={UNTITLED_PLACEHOLDER}
              slotProps={{ input: { disableUnderline: true } }}
              sx={{
                '& .MuiInput-input': {
                  fontSize: '2.25rem',
                  fontWeight: 700,
                  lineHeight: 1.2,
                  padding: 0,
                },
              }}
            />
          ) : (
            <Typography
              variant="h3"
              onClick={startEdit}
              sx={{
                fontSize: '2.25rem',
                fontWeight: 700,
                lineHeight: 1.2,
                cursor: 'text',
                color: title ? 'text.primary' : 'text.secondary',
                px: 1,
                mx: -1,
                borderRadius: 1,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {title || UNTITLED_PLACEHOLDER}
            </Typography>
          )}
        </Box>
        <IconPickerPopover
          anchorEl={iconAnchor}
          open={Boolean(iconAnchor)}
          onClose={() => setIconAnchor(null)}
          onSelect={(value) => update.mutate({ id, workspaceId, icon: value })}
          onRemove={icon ? () => update.mutate({ id, workspaceId, icon: null }) : undefined}
        />
        <CoverPicker
          anchorEl={coverAnchor}
          open={Boolean(coverAnchor)}
          onClose={() => setCoverAnchor(null)}
          onSelectPreset={(key) =>
            update.mutate({ id, workspaceId, coverPreset: key, coverUrl: null })
          }
          onSelectUrl={(url) =>
            update.mutate({ id, workspaceId, coverUrl: url, coverPreset: null })
          }
        />
      </Stack>
    </Box>
  )
}
