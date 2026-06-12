'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AddIcon,
  Box,
  Chip,
  CloseIcon,
  InputBase,
  LinkIcon,
  Menu,
  MenuItem,
  ListItemText,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { PageIcon } from '@/components/page/page-icon'

import { useActiveViewId } from './use-optimistic-cell'
import { useOptimisticRows } from '../use-view-rows'

interface RelationCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

interface RelationChip {
  rowId: string
  pageId: string
  title: string | null
  icon: string | null
}

/** Coerce the stored (computed) value into a typed `RelationChip[]`. */
function toChips(value: unknown): RelationChip[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is RelationChip =>
      Boolean(v) && typeof v === 'object' && typeof (v as RelationChip).rowId === 'string',
  )
}

/**
 * Relation cell. The (computed, read-only-on-the-wire) cell value is an array of
 * `RelationChip` objects. Chips link to the target item page (`/pages/[pageId]`).
 * A "+" opens a picker over `database.listLinkableRows`; selecting/removing writes
 * the FULL target-row id set via `database.setRelationLinks` — relations go through
 * `setRelationLinks`, NOT `updateCellValue`. After a write we invalidate the active
 * view so the server recomputes the chips (incl. the back-relation mirror).
 */
export function RelationCell({ pageId, rowId, propertyId, value, editable = true }: RelationCellProps) {
  const router = useRouter()
  const viewId = useActiveViewId()
  const { invalidateActive } = useOptimisticRows(pageId, viewId)

  const chips = toChips(value)
  const linkedIds = useMemo(() => chips.map((c) => c.rowId), [chips])

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')

  const setLinks = trpc.database.setRelationLinks.useMutation({
    onSettled: () => invalidateActive(),
  })

  const linkable = trpc.database.listLinkableRows.useQuery(
    { pageId, propertyId, query: query.trim() || undefined },
    { enabled: Boolean(anchorEl), retry: false },
  )

  function applyTargets(targetRowIds: string[]) {
    setLinks.mutate({ pageId, rowId, propertyId, targetRowIds })
  }

  function addTarget(targetRowId: string) {
    if (linkedIds.includes(targetRowId)) return
    applyTargets([...linkedIds, targetRowId])
  }

  function removeTarget(targetRowId: string) {
    applyTargets(linkedIds.filter((id) => id !== targetRowId))
  }

  function openTarget(chip: RelationChip) {
    router.push(`/pages/${chip.pageId}`)
  }

  const candidates = useMemo(() => (linkable.data ?? []).slice(0, 50), [linkable.data])

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
      {chips.map((chip) => (
        <Chip
          key={chip.rowId}
          size="small"
          icon={
            <span style={{ marginLeft: 6, display: 'inline-flex' }}>
              <PageIcon icon={chip.icon} size={14} fallback="📄" />
            </span>
          }
          label={chip.title || 'Без названия'}
          onClick={() => openTarget(chip)}
          onDelete={editable ? () => removeTarget(chip.rowId) : undefined}
          deleteIcon={editable ? <CloseIcon /> : undefined}
          clickable
        />
      ))}
      {editable ? (
        <Chip
          size="small"
          variant="outlined"
          icon={chips.length === 0 ? <LinkIcon /> : <AddIcon />}
          label={chips.length === 0 ? 'Связать' : 'Добавить'}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ cursor: 'pointer' }}
        />
      ) : chips.length === 0 ? (
        <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>—</span>
      ) : null}
      {editable ? (
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
              placeholder="Поиск элементов…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              fullWidth
              sx={{ fontSize: 14, px: 0.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
            />
          </Box>
          {linkable.isLoading ? (
            <MenuItem disabled>
              <em>Загрузка…</em>
            </MenuItem>
          ) : candidates.length === 0 ? (
            <MenuItem disabled>
              <em>Ничего не найдено</em>
            </MenuItem>
          ) : (
            candidates.map((c) => {
              const linked = linkedIds.includes(c.id)
              return (
                <MenuItem
                  key={c.id}
                  dense
                  selected={linked}
                  onClick={() => (linked ? removeTarget(c.id) : addTarget(c.id))}
                >
                  <ListItemText primary={c.title || 'Без названия'} />
                  {linked ? <CloseIcon fontSize="small" sx={{ color: 'text.secondary' }} /> : null}
                </MenuItem>
              )
            })
          )}
        </Menu>
      ) : null}
    </Box>
  )
}
