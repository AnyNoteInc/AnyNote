'use client'

import { Dialog, DialogContent, DialogTitle, Divider, Stack, Typography } from '@repo/ui/components'

import type { DatabaseSchema } from '../types'
import { PageAccessRulesPanel } from './page-access-rules-panel'
import { StructureLockToggle } from './structure-lock-toggle'

interface DatabaseAccessDialogProps {
  readonly pageId: string
  readonly properties: DatabaseSchema['properties']
  /** The viewer's database capabilities from `getByPage().myAccess`. */
  readonly myAccess: DatabaseSchema['myAccess']
  readonly open: boolean
  readonly onClose: () => void
}

/**
 * "Доступ и права" dialog. Hosts the structure-lock toggle and the page-level
 * access-rules panel. Only ever opened when the viewer can edit the structure
 * (the toolbar guards the entry), so the rule controls and the lock are live;
 * when the structure is locked the toggle is still shown so an OWNER/ADMIN can
 * unlock, while rule editing reflects the locked state.
 */
export function DatabaseAccessDialog({
  pageId,
  properties,
  myAccess,
  open,
  onClose,
}: DatabaseAccessDialogProps) {
  // Managing rules is a structure operation; if the structure is locked the rule
  // controls disable with the locked reason (the server enforces this regardless).
  const rulesDisabled = !myAccess.canEditStructure
  const disabledReason = myAccess.structureLocked ? 'Структура заблокирована' : 'Недостаточно прав'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Доступ и права</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Структура</Typography>
            <StructureLockToggle
              pageId={pageId}
              locked={myAccess.structureLocked}
              canToggle={myAccess.canEditStructure}
            />
          </Stack>

          <Divider />

          <Stack spacing={1}>
            <Typography variant="subtitle2">Правила доступа к строкам</Typography>
            <PageAccessRulesPanel
              pageId={pageId}
              properties={properties}
              disabled={rulesDisabled}
              disabledReason={disabledReason}
            />
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
