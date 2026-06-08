'use client'

import { useMemo } from 'react'
import { Box, Divider, MenuItem, Select, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { parseViewSettings } from '../types'
import type { DatabaseSchema, DatabaseViewEntry } from '../types'

interface GroupByPickerProps {
  readonly pageId: string
  readonly view: DatabaseViewEntry
  readonly properties: DatabaseSchema['properties']
}

const NONE = '__none__'

/** Group-by candidate types — choice/person properties whose values bucket cleanly. */
const GROUPABLE_TYPES = new Set(['STATUS', 'SELECT', 'PERSON'])

/**
 * Picker body for the BOARD layout's `settings.groupBy`. Lists every STATUS /
 * SELECT / PERSON property; choosing one writes `settings.groupBy.propertyId`
 * via `updateView` (merged into existing settings). Choosing «Без группировки»
 * clears it (the board then prompts to pick one). The board derives its columns
 * from the chosen property's `settings.options`.
 */
export function GroupByPicker({ pageId, view, properties }: GroupByPickerProps) {
  const utils = trpc.useUtils()
  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])

  const groupable = useMemo(
    () =>
      [...properties]
        .filter((p) => GROUPABLE_TYPES.has(p.type))
        .sort((a, b) => a.position - b.position),
    [properties],
  )

  const updateView = trpc.database.updateView.useMutation({
    onSuccess: () => utils.database.getByPage.invalidate({ pageId }),
  })

  const selectedId = settings.groupBy?.propertyId ?? NONE

  function persist(propertyId: string) {
    updateView.mutate({
      pageId,
      id: view.id,
      settings: {
        ...settings,
        groupBy: propertyId === NONE ? null : { propertyId },
      },
    })
  }

  return (
    <Box sx={{ p: 1.5, width: 280 }}>
      <Typography variant="subtitle2" sx={{ px: 0.5 }}>
        Группировка
      </Typography>
      <Divider sx={{ my: 1 }} />
      {groupable.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
          Нет свойств для группировки. Добавьте свойство «Статус» или «Выбор».
        </Typography>
      ) : (
        <Stack spacing={1}>
          <Select
            size="small"
            value={selectedId}
            onChange={(e) => persist(String(e.target.value))}
            sx={{ fontSize: 14 }}
            aria-label="Свойство группировки"
          >
            <MenuItem value={NONE}>
              <em>Без группировки</em>
            </MenuItem>
            {groupable.map((property) => (
              <MenuItem key={property.id} value={property.id}>
                {property.name}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            Колонки доски строятся из вариантов выбранного свойства.
          </Typography>
        </Stack>
      )}
    </Box>
  )
}
