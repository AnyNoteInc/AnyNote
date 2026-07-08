'use client'

import { FormControlLabel, Stack, Switch, Tooltip, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

interface StructureLockToggleProps {
  readonly pageId: string
  /** Current locked state (from `getByPage().myAccess.structureLocked`). */
  readonly locked: boolean
  /** Whether the viewer may flip the lock (structure editors / OWNER-ADMIN). */
  readonly canToggle: boolean
}

/**
 * "Заблокировать структуру" toggle. When locked, only OWNER/ADMIN may change the
 * schema (properties, views) — enforced server-side; this Switch just flips the
 * `DatabaseSource.structureLocked` flag via `setStructureLocked`. Disabled (with a
 * tooltip) when the viewer can't manage the structure.
 */
export function StructureLockToggle({ pageId, locked, canToggle }: StructureLockToggleProps) {
  const utils = trpc.useUtils()
  const setStructureLocked = trpc.database.setStructureLocked.useMutation({
    onSuccess: () => utils.database.getByPage.invalidate({ pageId }),
  })

  const control = (
    <Switch
      size="small"
      checked={locked}
      disabled={!canToggle || setStructureLocked.isPending}

      onChange={(e) => setStructureLocked.mutate({ pageId, locked: e.target.checked })}
      slotProps={{ input: { 'aria-label': 'Заблокировать структуру' } }}
    />
  )

  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        control={
          canToggle ? (
            control
          ) : (
            <Tooltip title="Недостаточно прав">
              <span>{control}</span>
            </Tooltip>
          )
        }
        label="Заблокировать структуру"
        labelPlacement="start"
        sx={{
          ml: 0,
          justifyContent: 'space-between',
          '& .MuiFormControlLabel-label': { fontSize: 14 },
        }}
      />
      <Typography variant="caption" color="text.secondary">
        Когда структура заблокирована, изменять свойства и представления могут только владельцы и
        администраторы пространства.
      </Typography>
    </Stack>
  )
}
