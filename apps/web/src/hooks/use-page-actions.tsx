'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type PageLike = { id: string; title: string | null }

export type UsePageActionsResult = {
  toggleFavorite: () => void
  copyLink: () => Promise<void>
  duplicate: () => void
  openDeleteConfirm: () => void
  dialogs: ReactNode
}

// Shared handlers + delete-confirm dialog reused by both the sidebar page
// context menu and the breadcrumb actions menu. The Move and Rename dialogs
// remain outside the hook — each host owns them because the page-picker state
// they need is host-specific.
export function usePageActions(
  page: PageLike,
  workspaceId: string,
  isFavorite: boolean,
): UsePageActionsResult {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const invalidate = () => {
    void utils.page.listByWorkspace.invalidate({ workspaceId })
    void utils.page.listFavorites.invalidate({ workspaceId })
    void utils.page.listTrashed.invalidate({ workspaceId })
    void utils.page.getById.invalidate({ id: page.id })
  }

  const addFavorite = trpc.page.addFavorite.useMutation({ onSuccess: invalidate })
  const removeFavorite = trpc.page.removeFavorite.useMutation({ onSuccess: invalidate })
  const softDelete = trpc.page.softDelete.useMutation({ onSuccess: invalidate })
  const duplicateMutation = trpc.page.duplicate.useMutation({
    onSuccess: (data) => {
      invalidate()
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const toggleFavorite = () => {
    if (isFavorite) removeFavorite.mutate({ pageId: page.id })
    else addFavorite.mutate({ pageId: page.id })
  }

  const copyLink = async () => {
    const url = `${window.location.origin}/workspaces/${workspaceId}/pages/${page.id}`
    await navigator.clipboard.writeText(url)
  }

  const duplicate = () => duplicateMutation.mutate({ pageId: page.id })

  const openDeleteConfirm = () => setDeleteOpen(true)

  const handleDeleteConfirm = () => {
    softDelete.mutate({ id: page.id, workspaceId })
    setDeleteOpen(false)
  }

  const dialogs: ReactNode = (
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
  )

  return {
    toggleFavorite,
    copyLink,
    duplicate,
    openDeleteConfirm,
    dialogs,
  }
}
