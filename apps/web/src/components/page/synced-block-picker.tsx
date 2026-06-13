'use client'

import { useState } from 'react'
import {
  AddIcon,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@repo/ui/components'
import { emptySyncedBlockDoc } from '@repo/editor'

import { trpc } from '@/trpc/client'

export type SyncedBlockPick = { blockId: string }

interface SyncedBlockPickerProps {
  readonly open: boolean
  readonly workspaceId: string
  /** The current page — the origin a newly-created synced block anchors to. */
  readonly originPageId: string
  readonly onCancel: () => void
  readonly onPick: (pick: SyncedBlockPick) => void
}

/**
 * Picker for the `/синхронизированный блок` slash command. Two paths (spec §5):
 *  - «Создать новый» → `syncedBlock.create({ originPageId, content: emptyDoc })`
 *    then insert the returned id (the nested editor seeds the live doc on mount).
 *  - «Вставить существующий» → `syncedBlock.list` (access-filtered to blocks the
 *    caller can reach) → insert the chosen id.
 */
export function SyncedBlockPicker({
  open,
  workspaceId,
  originPageId,
  onCancel,
  onPick,
}: SyncedBlockPickerProps) {
  const listQuery = trpc.syncedBlock.list.useQuery({ workspaceId }, { enabled: open })
  const create = trpc.syncedBlock.create.useMutation()
  const [busy, setBusy] = useState(false)

  const blocks = listQuery.data?.blocks ?? []

  const handleCreate = async () => {
    setBusy(true)
    try {
      const result = await create.mutateAsync({
        originPageId,
        content: emptySyncedBlockDoc(),
      })
      onPick({ blockId: result.id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Синхронизированный блок</DialogTitle>
      <DialogContent dividers>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={busy}
          onClick={() => void handleCreate()}
          sx={{ mb: 1.5, justifyContent: 'flex-start' }}
        >
          Создать новый
        </Button>
        <Divider sx={{ mb: 1 }} />
        <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
          Вставить существующий
        </Typography>
        {listQuery.isPending ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={20} />
          </Box>
        ) : blocks.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, px: 0.5 }}>
            В этом воркспейсе пока нет синхронизированных блоков
          </Typography>
        ) : (
          <List dense disablePadding>
            {blocks.map((block, index) => (
              <ListItemButton
                key={block.id}
                disabled={busy}
                onClick={() => onPick({ blockId: block.id })}
              >
                <ListItemText primary={`Синхронизированный блок ${index + 1}`} />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
      </DialogActions>
    </Dialog>
  )
}
