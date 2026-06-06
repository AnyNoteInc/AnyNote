'use client'

import { useState } from 'react'
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
  EmojiIconButton,
  Stack,
  StarIcon,
  StarBorderIcon,
  LinkIcon,
  ContentCopyIcon,
  DriveFileRenameOutlineIcon,
  MovingIcon,
  BookmarkAddIcon,
  DeleteIcon,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'
import { usePageActions } from '@/hooks/use-page-actions'
import { SaveAsTemplateDialog } from '@/components/templates'
import type { PageItem } from './types'

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
  const [renameValue, setRenameValue] = useState('')
  const [renameIcon, setRenameIcon] = useState<string | null>(null)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)

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
    setRenameValue(page.title ?? '')
    setRenameIcon(page.icon)
    setRenameOpen(true)
    onClose()
  }

  const handleRenameSubmit = () => {
    rename.mutate({ id: page.id, workspaceId, title: renameValue, icon: renameIcon })
    setRenameOpen(false)
  }

  const handleOpenMove = () => {
    onOpenMoveDialog()
    onClose()
  }

  const handleOpenSaveTemplate = () => {
    setSaveTemplateOpen(true)
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
          {isFavorite ? 'Убрать из избранного' : 'В избранное'}
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

        <MenuItem onClick={handleOpenSaveTemplate} sx={menuItemSx}>
          <BookmarkAddIcon fontSize="small" />
          Сохранить как шаблон
        </MenuItem>

        <MenuItem onClick={handleOpenDelete} sx={{ ...menuItemSx, color: 'error.main' }}>
          <DeleteIcon fontSize="small" />В корзину
        </MenuItem>
      </Menu>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Переименовать</DialogTitle>
        <DialogContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <EmojiIconButton
              value={renameIcon}
              onChange={setRenameIcon}
              onRemove={() => setRenameIcon(null)}
              aria-label="Изменить иконку"
              sx={{ width: 40, height: 40, p: 0.5, borderRadius: 1 }}
              emojiSize={28}
            />
            <TextField
              autoFocus
              fullWidth
              size="small"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleRenameSubmit()
                }
              }}
            />
          </Stack>
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

      <SaveAsTemplateDialog
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        workspaceId={workspaceId}
        pageId={page.id}
        defaultTitle={page.title ?? ''}
        defaultIcon={page.icon}
      />

      {actions.dialogs}
    </>
  )
}
