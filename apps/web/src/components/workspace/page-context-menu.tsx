"use client"

import { useState } from "react"
import {
  Menu,
  MenuItem,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  StarIcon,
  StarBorderIcon,
  LinkIcon,
  ContentCopyIcon,
  DriveFileRenameOutlineIcon,
  MovingIcon,
  DeleteIcon,
} from "@repo/ui/components"
import { trpc } from "@/trpc/client"
import { usePageActions } from "@/hooks/use-page-actions"
import type { PageItem } from "./types"

type Props = {
  anchorEl: HTMLElement | null
  onClose: () => void
  page: PageItem
  workspaceId: string
  isFavorite: boolean
  onOpenMoveDialog: () => void
}

const menuItemSx = { gap: 1, fontSize: 13 } as const

export function PageContextMenu({
  anchorEl,
  onClose,
  page,
  workspaceId,
  isFavorite,
  onOpenMoveDialog,
}: Props) {
  const actions = usePageActions(page, workspaceId, isFavorite)
  const utils = trpc.useUtils()

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")

  const rename = trpc.page.rename.useMutation({
    onSuccess: () => {
      void utils.page.listByWorkspace.invalidate({ workspaceId })
      void utils.page.getById.invalidate({ id: page.id })
    },
  })

  const handleToggleFavorite = () => {
    actions.toggleFavorite()
    onClose()
  }

  const handleCopyLink = () => {
    void actions.copyLink()
    onClose()
  }

  const handleDuplicate = () => {
    actions.duplicate()
    onClose()
  }

  const handleOpenRename = () => {
    setRenameValue(page.title ?? "")
    setRenameOpen(true)
    onClose()
  }

  const handleRenameSubmit = () => {
    rename.mutate({ id: page.id, workspaceId, title: renameValue })
    setRenameOpen(false)
  }

  const handleOpenMove = () => {
    onOpenMoveDialog()
    onClose()
  }

  const handleOpenDelete = () => {
    actions.openDeleteConfirm()
    onClose()
  }

  return (
    <>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}>
        <MenuItem onClick={handleToggleFavorite} sx={menuItemSx}>
          {isFavorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          {isFavorite ? "Убрать из избранного" : "В избранное"}
        </MenuItem>

        <Divider />

        <MenuItem onClick={handleCopyLink} sx={menuItemSx}>
          <LinkIcon fontSize="small" />
          Копировать ссылку
        </MenuItem>

        <MenuItem onClick={handleDuplicate} sx={menuItemSx}>
          <ContentCopyIcon fontSize="small" />
          Дублировать
        </MenuItem>

        <MenuItem onClick={handleOpenRename} sx={menuItemSx}>
          <DriveFileRenameOutlineIcon fontSize="small" />
          Переименовать
        </MenuItem>

        <MenuItem onClick={handleOpenMove} sx={menuItemSx}>
          <MovingIcon fontSize="small" />
          Переместить
        </MenuItem>

        <MenuItem onClick={handleOpenDelete} sx={{ ...menuItemSx, color: "error.main" }}>
          <DeleteIcon fontSize="small" />В корзину
        </MenuItem>
      </Menu>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Переименовать</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleRenameSubmit()
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRenameOpen(false)}>
            Отмена
          </Button>
          <Button onClick={handleRenameSubmit} variant="contained">
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      {actions.dialogs}
    </>
  )
}
