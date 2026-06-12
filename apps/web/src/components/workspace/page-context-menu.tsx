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
  Inventory2Icon,
  LockIcon,
  GroupIcon,
  DeleteIcon,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'
import { usePageActions } from '@/hooks/use-page-actions'
import { SaveAsTemplateDialog } from '@/components/templates'
import { PageIcon } from '@/components/page/page-icon'
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

  // Map the page's collection to its kind so we only offer the relevant move
  // target. Falls back to showing both items when the kind can't be resolved.
  const { data: collections } = trpc.collection.list.useQuery(
    { workspaceId },
    { enabled: Boolean(anchorEl) },
  )
  const currentKind = collections?.find((c) => c.id === page.collectionId)?.kind ?? null
  const showMakePrivate = currentKind !== 'PERSONAL'
  const showMoveToTeam = currentKind !== 'TEAM'

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

  const handleArchive = () => {
    actions.handleArchive()
    onClose()
  }

  const handleMakePrivate = () => {
    actions.handleMakePrivate()
    onClose()
  }

  const handleMoveToTeam = () => {
    actions.handleMoveToTeam()
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

        <Divider />

        <MenuItem onClick={handleArchive} sx={menuItemSx}>
          <Inventory2Icon fontSize="small" />В архив
        </MenuItem>

        {showMakePrivate ? (
          <MenuItem onClick={handleMakePrivate} sx={menuItemSx}>
            <LockIcon fontSize="small" />
            Сделать личной
          </MenuItem>
        ) : null}

        {showMoveToTeam ? (
          <MenuItem onClick={handleMoveToTeam} sx={menuItemSx}>
            <GroupIcon fontSize="small" />В команду
          </MenuItem>
        ) : null}

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
              // PageIcon understands the `url:` image-icon format — the default
              // emoji span would render it as raw text.
              renderValue={(v) => <PageIcon icon={v} size={28} fallback="📄" />}
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
