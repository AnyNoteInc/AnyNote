'use client'

import { useMemo } from 'react'
import {
  Box,
  Button,
  Divider,
  LockIcon,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PropertyTypeIcon } from '../property-type-icon'
import { parseViewSettings } from '../types'
import type { DatabaseSchema, DatabaseViewEntry } from '../types'

type Property = DatabaseSchema['properties'][number]

interface PropertyVisibilityPanelProps {
  readonly pageId: string
  readonly view: DatabaseViewEntry
  readonly properties: DatabaseSchema['properties']
  readonly systemTitleProperty: DatabaseSchema['systemTitleProperty']
}

// Whole-row affordance: name + type icon on the left, switch on the right. The
// entire row is a comfortable click target (not just the 32px switch) via the
// FormControlLabel's full-width layout + a hover background. Hoisted so the object
// identity is stable across renders/rows instead of re-allocated per row.
const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  pl: 1,
  pr: 0.5,
  py: 0.25,
  minHeight: 34,
  borderRadius: 1,
  cursor: 'pointer',
  transition: 'background-color 120ms ease',
  '&:hover': { bgcolor: 'action.hover' },
} as const

/**
 * Popover body listing every property with a visibility toggle. Writes
 * `view.settings.visibleProperties` (the explicit allow-list) via `updateView`,
 * merging into the existing settings. Display-only: hidden columns' cells are
 * still returned by the API — this never restricts access.
 *
 * When no `visibleProperties` is set yet, all properties are visible; the first
 * toggle materialises the full list minus the toggled-off one so subsequent
 * toggles are additive/subtractive against a concrete set. The system Title
 * column is always shown and is not togglable.
 *
 * Properties are split into «Показано» / «Скрыто» sections so the visible/hidden
 * state is structural and scannable; a header shows the live count and a bulk
 * «Показать все / Скрыть все» toggle.
 */
export function PropertyVisibilityPanel({
  pageId,
  view,
  properties,
  systemTitleProperty,
}: PropertyVisibilityPanelProps) {
  const utils = trpc.useUtils()
  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])

  const sortedProperties = useMemo(
    () => [...properties].sort((a, b) => a.position - b.position),
    [properties],
  )

  const updateView = trpc.database.updateView.useMutation({
    // Visibility is display-only: hidden columns' cells are still returned by the
    // API (`listRows` ignores `visibleProperties`), so the row payload is unchanged.
    // Only the view schema/settings consumed by `getByPage` drives column rendering.
    onSuccess: () => utils.database.getByPage.invalidate({ pageId }),
  })

  // null/absent visibleProperties means "all visible".
  const visibleSet = useMemo(
    () => (settings.visibleProperties ? new Set(settings.visibleProperties) : null),
    [settings.visibleProperties],
  )

  function isVisible(propertyId: string): boolean {
    return visibleSet === null || visibleSet.has(propertyId)
  }

  // Materialise the concrete allow-list from the current effective visibility so
  // every write is against a concrete set (never the implicit "all").
  function materialiseVisible(): Set<string> {
    return new Set(visibleSet ? [...visibleSet] : sortedProperties.map((p) => p.id))
  }

  function persist(next: Set<string>) {
    updateView.mutate({
      pageId,
      id: view.id,
      settings: { ...settings, visibleProperties: [...next] },
    })
  }

  function toggle(propertyId: string, next: boolean) {
    const current = materialiseVisible()
    if (next) current.add(propertyId)
    else current.delete(propertyId)
    persist(current)
  }

  const { shown, hidden } = useMemo(() => {
    const s: Property[] = []
    const h: Property[] = []
    for (const property of sortedProperties) {
      ;(isVisible(property.id) ? s : h).push(property)
    }
    return { shown: s, hidden: h }
    // isVisible is derived from visibleSet; recompute when membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedProperties, visibleSet])

  const total = sortedProperties.length
  // +1 for the always-on system Title column in the visible count denominator/numerator.
  const visibleCount = shown.length + 1
  const allShown = hidden.length === 0
  const pending = updateView.isPending

  function showAll() {
    persist(new Set(sortedProperties.map((p) => p.id)))
  }

  function hideAll() {
    // Empty allow-list = only the always-on system Title column remains.
    persist(new Set())
  }

  return (
    <Box sx={{ p: 1.5, width: 280 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 0.5, gap: 1 }}
      >
        <Typography variant="subtitle2">Свойства</Typography>
        {total > 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            aria-label={`Показано ${visibleCount} из ${total + 1} свойств`}
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {visibleCount} / {total + 1}
          </Typography>
        ) : null}
      </Stack>

      {total > 0 ? (
        <Box sx={{ px: 0.5, mt: 0.5 }}>
          <Button
            size="small"
            variant="text"
            onClick={allShown ? hideAll : showAll}
            disabled={pending}
            sx={{ minWidth: 0, px: 0.75, fontSize: 12, textTransform: 'none' }}
          >
            {allShown ? 'Скрыть все' : 'Показать все'}
          </Button>
        </Box>
      ) : null}

      <Divider sx={{ my: 1 }} />

      {total === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
          Нет свойств. Добавьте свойство через меню «+ Свойство».
        </Typography>
      ) : (
        <Stack spacing={1.25}>
          <Box component="section" role="group" aria-label="Показанные свойства">
            <SectionLabel>Показано</SectionLabel>
            <Stack spacing={0}>
              {/* System Title is always shown and never togglable. */}
              <Box sx={{ ...rowSx, cursor: 'default', '&:hover': { bgcolor: 'transparent' } }}>
                <PropertyTypeIcon
                  type="TEXT"
                  sx={{ fontSize: 18, color: 'text.disabled', flexShrink: 0 }}
                />
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ flex: 1, fontSize: 14, color: 'text.primary' }}
                >
                  {systemTitleProperty.name}
                </Typography>
                <Tooltip title="Системный столбец — всегда виден" placement="left">
                  <Box sx={{ display: 'inline-flex', color: 'text.disabled', px: 0.5 }}>
                    <LockIcon sx={{ fontSize: 16 }} aria-label="Всегда виден" />
                  </Box>
                </Tooltip>
              </Box>

              {shown.map((property) => (
                <PropertyRow
                  key={property.id}
                  property={property}
                  checked
                  disabled={pending}
                  onToggle={(next) => toggle(property.id, next)}
                />
              ))}
            </Stack>
          </Box>

          {hidden.length > 0 ? (
            <Box component="section" role="group" aria-label="Скрытые свойства">
              <SectionLabel>Скрыто</SectionLabel>
              <Stack spacing={0}>
                {hidden.map((property) => (
                  <PropertyRow
                    key={property.id}
                    property={property}
                    checked={false}
                    disabled={pending}
                    onToggle={(next) => toggle(property.id, next)}
                  />
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      )}

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 1.25, px: 0.5 }}
      >
        Влияет только на отображение в этом представлении.
      </Typography>
    </Box>
  )
}

function SectionLabel({ children }: { readonly children: string }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        display: 'block',
        px: 1,
        mb: 0.25,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontWeight: 600,
      }}
    >
      {children}
    </Typography>
  )
}

interface PropertyRowProps {
  readonly property: Property
  readonly checked: boolean
  readonly disabled: boolean
  readonly onToggle: (next: boolean) => void
}

function PropertyRow({ property, checked, disabled, onToggle }: PropertyRowProps) {
  // The whole row toggles; clicking anywhere but the switch flips it (the switch's
  // own onChange handles direct interaction). Keeps the click target generous.
  return (
    <Box
      sx={rowSx}
      onClick={() => {
        if (!disabled) onToggle(!checked)
      }}
    >
      <PropertyTypeIcon
        type={property.type}
        sx={{
          fontSize: 18,
          flexShrink: 0,
          color: checked ? 'text.secondary' : 'text.disabled',
        }}
      />
      <Typography
        variant="body2"
        noWrap
        sx={{
          flex: 1,
          fontSize: 14,
          color: checked ? 'text.primary' : 'text.secondary',
        }}
      >
        {property.name}
      </Typography>
      <Switch
        size="small"
        checked={checked}
        disabled={disabled}
        // Stop the row's onClick from double-firing alongside the switch's change.
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onToggle(e.target.checked)}
        inputProps={{ 'aria-label': `Показывать «${property.name}»` }}
      />
    </Box>
  )
}
