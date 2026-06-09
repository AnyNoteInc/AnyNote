'use client'

import { useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreVertIcon,
  Stack,
  TextField,
  Typography,
  DeleteIcon,
  EditIcon,
  TuneIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import type { DatabasePropertyView } from './types'
import { PropertySettingsDialog } from './property-config/property-settings-dialog'

interface PropertyHeaderCellProps {
  readonly pageId: string
  readonly property: DatabasePropertyView
  readonly editable?: boolean
}

/**
 * Header cell for a user property. A menu offers rename (updateProperty) and
 * delete (deleteProperty, with a confirm because deleting a property cascades
 * its cells). The system Title column uses a plain label and never renders this.
 */
export function PropertyHeaderCell({ pageId, property, editable = true }: PropertyHeaderCellProps) {
  const utils = trpc.useUtils()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftName, setDraftName] = useState(property.name)

  // A property change touches the schema AND the rows (deleting a property drops
  // its cells; an options/type change re-renders cells), so invalidate both.
  const invalidate = async () => {
    await Promise.all([
      utils.database.getByPage.invalidate({ pageId }),
      utils.database.listRows.invalidate({ pageId }),
    ])
  }
  const updateProperty = trpc.database.updateProperty.useMutation({ onSuccess: invalidate })
  const deleteProperty = trpc.database.deleteProperty.useMutation({ onSuccess: invalidate })

  function openRename() {
    setDraftName(property.name)
    setRenameOpen(true)
    setAnchorEl(null)
  }

  function submitRename() {
    const next = draftName.trim()
    if (next && next !== property.name) {
      updateProperty.mutate({ pageId, id: property.id, name: next })
    }
    setRenameOpen(false)
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }} noWrap>
        {property.name}
      </Typography>
      {editable ? (
        <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ ml: 'auto' }}>
          <MoreVertIcon fontSize="small" />
        </IconButton>
      ) : null}

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={openRename}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Переименовать" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setSettingsOpen(true)
            setAnchorEl(null)
          }}
        >
          <ListItemIcon>
            <TuneIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Настроить свойство" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setConfirmOpen(true)
            setAnchorEl(null)
          }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Удалить" />
        </MenuItem>
      </Menu>

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)}>
        <DialogTitle>Переименовать свойство</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
            }}
            sx={{ mt: 1, minWidth: 280 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={submitRename} disabled={updateProperty.isPending}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Удалить свойство «{property.name}»?</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Значения этого свойства во всех строках будут удалены. Действие необратимо.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteProperty.isPending}
            onClick={() => {
              deleteProperty.mutate({ pageId, id: property.id })
              setConfirmOpen(false)
            }}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>

      <PropertySettingsDialog
        pageId={pageId}
        property={property}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </Box>
  )
}
