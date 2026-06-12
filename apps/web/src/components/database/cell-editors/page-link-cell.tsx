'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Box,
  Chip,
  CloseIcon,
  DescriptionIcon,
  InputBase,
  Menu,
  MenuItem,
  ListItemText,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { PageIcon } from '@/components/page/page-icon'

import { useCellUpdate, useDatabaseWorkspaceId } from './use-optimistic-cell'

interface PageLinkCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

/**
 * Page-link cell. The stored value is a target page id. Renders an icon+title chip
 * linking to `/pages/[id]`; clicking the chip body (when editable) opens a picker
 * over `page.listByWorkspace` (client-filtered by title). The page's existence in
 * the workspace is re-checked server-side by `updateCellValue` on write.
 */
export function PageLinkCell({ pageId, rowId, propertyId, value, editable = true }: PageLinkCellProps) {
  const { commit } = useCellUpdate(pageId)
  const workspaceId = useDatabaseWorkspaceId()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')

  const { data: pages } = trpc.page.listByWorkspace.useQuery(
    { workspaceId },
    { enabled: Boolean(workspaceId) },
  )

  const selectedId = typeof value === 'string' && value !== '' ? value : null
  const selected = pages?.find((p) => p.id === selectedId) ?? null

  const filtered = useMemo(() => {
    const all = pages ?? []
    const q = query.trim().toLowerCase()
    const matched = q
      ? all.filter((p) => (p.title ?? '').toLowerCase().includes(q))
      : all
    return matched.slice(0, 50)
  }, [pages, query])

  function pick(id: string | null) {
    setAnchorEl(null)
    setQuery('')
    commit(rowId, propertyId, id)
  }

  const chipLabel = selected ? (selected.title || 'Без названия') : null

  if (!editable) {
    return selectedId && chipLabel ? (
      <Chip
        size="small"
        component={Link}
        href={`/pages/${selectedId}`}
        clickable
        icon={
          <span style={{ marginLeft: 6, display: 'inline-flex' }}>
            <PageIcon icon={selected?.icon} size={14} fallback="📄" />
          </span>
        }
        label={chipLabel}
        onClick={(e) => e.stopPropagation()}
      />
    ) : (
      <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>—</span>
    )
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {selectedId && chipLabel ? (
        <Chip
          size="small"
          component={Link}
          href={`/pages/${selectedId}`}
          clickable
          icon={
          <span style={{ marginLeft: 6, display: 'inline-flex' }}>
            <PageIcon icon={selected?.icon} size={14} fallback="📄" />
          </span>
        }
          label={chipLabel}
          onDelete={() => pick(null)}
          deleteIcon={<CloseIcon />}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Chip
          size="small"
          variant="outlined"
          icon={<DescriptionIcon />}
          label="Выбрать страницу"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ cursor: 'pointer' }}
        />
      )}
      {selectedId ? (
        <Chip
          size="small"
          variant="outlined"
          label="Изменить"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ cursor: 'pointer' }}
        />
      ) : null}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => {
          setAnchorEl(null)
          setQuery('')
        }}
        slotProps={{ paper: { sx: { width: 280, maxHeight: 360 } } }}
      >
        <Box sx={{ px: 1, py: 0.5 }}>
          <InputBase
            autoFocus
            value={query}
            placeholder="Поиск страниц…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            fullWidth
            sx={{ fontSize: 14, px: 0.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
          />
        </Box>
        {filtered.length === 0 ? (
          <MenuItem disabled>
            <em>Ничего не найдено</em>
          </MenuItem>
        ) : (
          filtered.map((p) => (
            <MenuItem key={p.id} onClick={() => pick(p.id)} dense selected={p.id === selectedId}>
              <Box component="span" sx={{ mr: 1, display: 'inline-flex' }}>
                <PageIcon icon={p.icon} size={14} fallback="📄" />
              </Box>
              <ListItemText primary={p.title || 'Без названия'} />
            </MenuItem>
          ))
        )}
      </Menu>
    </Box>
  )
}
