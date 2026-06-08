'use client'

import { useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

export type EmbeddedDatabasePick = { sourceId: string; viewId: string | null }

interface EmbeddedDatabasePickerProps {
  readonly open: boolean
  readonly workspaceId: string
  readonly onCancel: () => void
  readonly onPick: (pick: EmbeddedDatabasePick) => void
}

/**
 * Picker for the `/база данных` slash command: lists the workspace's DATABASE
 * pages, and on select resolves the chosen page to its source/default-view ids
 * (`database.getByPage`) so the editor can insert an `embeddedDatabase` node.
 */
export function EmbeddedDatabasePicker({
  open,
  workspaceId,
  onCancel,
  onPick,
}: EmbeddedDatabasePickerProps) {
  const pagesQuery = trpc.page.listByWorkspace.useQuery(
    { workspaceId },
    { enabled: open },
  )
  const utils = trpc.useUtils()
  const [resolving, setResolving] = useState(false)

  const databases = (pagesQuery.data ?? []).filter((p) => p.type === 'DATABASE')

  const handlePick = async (pageId: string) => {
    setResolving(true)
    try {
      const view = await utils.database.getByPage.fetch({ pageId })
      onPick({ sourceId: view.source.id, viewId: view.views[0]?.id ?? null })
    } finally {
      setResolving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Встроить базу данных</DialogTitle>
      <DialogContent dividers>
        {pagesQuery.isPending ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={20} />
          </Box>
        ) : databases.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            В этом воркспейсе пока нет баз данных
          </Typography>
        ) : (
          <List dense disablePadding>
            {databases.map((db) => (
              <ListItemButton
                key={db.id}
                disabled={resolving}
                onClick={() => void handlePick(db.id)}
              >
                <ListItemText primary={db.title || 'Без названия'} />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={resolving}>
          Отмена
        </Button>
      </DialogActions>
    </Dialog>
  )
}
