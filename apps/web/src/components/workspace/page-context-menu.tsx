"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Menu,
  MenuItem,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
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
  const router = useRouter()
  const utils = trpc.useUtils()

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  const invalidate = () => {
    void utils.page.listByWorkspace.invalidate({ workspaceId })
    void utils.page.listFavorites.invalidate({ workspaceId })
    void utils.page.listTrashed.invalidate({ workspaceId })
  }

  const addFavorite = trpc.page.addFavorite.useMutation({ onSuccess: invalidate })
  const removeFavorite = trpc.page.removeFavorite.useMutation({ onSuccess: invalidate })
  const rename = trpc.page.rename.useMutation({ onSuccess: invalidate })
  const softDelete = trpc.page.softDelete.useMutation({ onSuccess: invalidate })
  const duplicate = trpc.page.duplicate.useMutation({
    onSuccess: (data) => {
      invalidate()
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const handleToggleFavorite = () => {
    if (isFavorite) {
      removeFavorite.mutate({ pageId: page.id })
    } else {
      addFavorite.mutate({ pageId: page.id })
    }
    onClose()
  }

  const handleCopyLink = () => {
    const url = `${window.location.origin}/workspaces/${workspaceId}/pages/${page.id}`
    void navigator.clipboard.writeText(url)
    onClose()
  }

  const handleDuplicate = () => {
    duplicate.mutate({ pageId: page.id })
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
    setDeleteOpen(true)
    onClose()
  }

  const handleDeleteConfirm = () => {
    softDelete.mutate({ id: page.id, workspaceId })
    setDeleteOpen(false)
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

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Удалить страницу?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Страница и все дочерние страницы будут перемещены в корзину.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteOpen(false)}>
            Отмена
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
