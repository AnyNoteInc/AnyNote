'use client'

import { useMemo } from 'react'
import {
  Box,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { parseViewSettings } from '../types'
import type { DatabaseSchema, DatabaseViewEntry } from '../types'

interface PropertyVisibilityPanelProps {
  readonly pageId: string
  readonly view: DatabaseViewEntry
  readonly properties: DatabaseSchema['properties']
  readonly systemTitleProperty: DatabaseSchema['systemTitleProperty']
}

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

  function toggle(propertyId: string, next: boolean) {
    // Materialise the concrete allow-list from the current effective visibility,
    // then add/remove the toggled property.
    const current = new Set(
      visibleSet ? [...visibleSet] : sortedProperties.map((p) => p.id),
    )
    if (next) current.add(propertyId)
    else current.delete(propertyId)
    updateView.mutate({
      pageId,
      id: view.id,
      settings: { ...settings, visibleProperties: [...current] },
    })
  }

  return (
    <Box sx={{ p: 1.5, width: 280 }}>
      <Typography variant="subtitle2" sx={{ px: 0.5 }}>
        Свойства
      </Typography>
      <Divider sx={{ my: 1 }} />
      <Stack spacing={0.25}>
        <FormControlLabel
          control={<Switch size="small" checked disabled />}
          label={systemTitleProperty.name}
          sx={{ ml: 0, justifyContent: 'space-between', '& .MuiFormControlLabel-label': { fontSize: 14 } }}
          labelPlacement="start"
        />
        {sortedProperties.map((property) => (
          <FormControlLabel
            key={property.id}
            control={
              <Switch
                size="small"
                checked={isVisible(property.id)}
                onChange={(e) => toggle(property.id, e.target.checked)}
              />
            }
            label={property.name}
            sx={{ ml: 0, justifyContent: 'space-between', '& .MuiFormControlLabel-label': { fontSize: 14 } }}
            labelPlacement="start"
          />
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, px: 0.5 }}>
        Влияет только на отображение в этом представлении.
      </Typography>
    </Box>
  )
}
