'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import {
  Button,
  ContentCopyIcon,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  EditIcon,
  FileDownloadIcon,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreHorizIcon,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { TemplateMetaDialog } from './template-meta-dialog'

type Props = {
  templateId: string
  workspaceId: string
  backingPageId: string | null
  canEdit: boolean
  title: string
  icon: string | null
  description: string | null
}

export function TemplateActionsMenu({
  templateId,
  workspaceId,
  backingPageId,
  canEdit,
  title,
  icon,
  description,
}: Readonly<Props>) {
  const router = useRouter()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const closeMenu = () => setAnchorEl(null)

  const remove = trpc.template.delete.useMutation({
    onSuccess: () => router.push('/marketplace'),
  })

  const handleCopyLink = () => {
    navigator.clipboard
      .writeText(`${window.location.origin}/marketplace/templates/${templateId}`)
      .catch(() => undefined)
    closeMenu()
  }

  const handleExport = () => {
    if (backingPageId) window.open(`/api/pages/${backingPageId}/export/md`, '_blank')
    closeMenu()
  }

  return (
    <>
      <IconButton
        size="small"
        aria-label="Действия с шаблоном"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreHorizIcon />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        {canEdit && (
          <MenuItem
            onClick={() => {
              setMetaOpen(true)
              closeMenu()
            }}
          >
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Редактировать</ListItemText>
          </MenuItem>
        )}
        {canEdit && (
          <MenuItem
            onClick={() => {
              setDeleteOpen(true)
              closeMenu()
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>Удалить шаблон</ListItemText>
          </MenuItem>
        )}
        {canEdit && <Divider />}
        <MenuItem onClick={handleCopyLink}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Копировать ссылку</ListItemText>
        </MenuItem>
        {backingPageId && (
          <MenuItem onClick={handleExport}>
            <ListItemIcon>
              <FileDownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Экспорт (Markdown)</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <TemplateMetaDialog
        open={metaOpen}
        onClose={() => setMetaOpen(false)}
        templateId={templateId}
        workspaceId={workspaceId}
        initialTitle={title}
        initialIcon={icon}
        initialDescription={description}
      />

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Удалить шаблон «{title}»?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">Это действие необратимо.</Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => remove.mutate({ templateId, workspaceId })}
            disabled={remove.isPending}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
