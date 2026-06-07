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
  copyText: () => Promise<void>
  duplicate: () => void
  openDeleteConfirm: () => void
  handleArchive: () => void
  handleMakePrivate: () => void
  handleMoveToTeam: () => void
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

  // Archiving and collection moves change which lists a page appears in, so they
  // refresh the archive + shared lists and the collection list on top of the
  // workspace tree.
  const invalidateCollections = () => {
    void utils.page.listByWorkspace.invalidate({ workspaceId })
    void utils.page.listArchived.invalidate({ workspaceId })
    void utils.page.listShared.invalidate({ workspaceId })
    void utils.collection.list.invalidate({ workspaceId })
  }

  const addFavorite = trpc.page.addFavorite.useMutation({ onSuccess: invalidate })
  const removeFavorite = trpc.page.removeFavorite.useMutation({ onSuccess: invalidate })
  const softDelete = trpc.page.softDelete.useMutation({ onSuccess: invalidate })
  const archive = trpc.page.archive.useMutation({ onSuccess: invalidateCollections })
  const moveToCollection = trpc.page.moveToCollection.useMutation({
    onSuccess: invalidateCollections,
  })
  const duplicateMutation = trpc.page.duplicate.useMutation({
    onSuccess: (data) => {
      invalidate()
      router.push(`/pages/${data.id}`)
    },
  })

  const toggleFavorite = () => {
    if (isFavorite) removeFavorite.mutate({ pageId: page.id })
    else addFavorite.mutate({ pageId: page.id })
  }

  const copyLink = async () => {
    const url = `${window.location.origin}/pages/${page.id}`
    await navigator.clipboard.writeText(url)
  }

  // Copy the page rendered as Markdown (same output as the .md export route).
  const copyText = async () => {
    const res = await fetch(`/api/pages/${page.id}/export/md`, {
      credentials: 'same-origin',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const md = await res.text()
    await navigator.clipboard.writeText(md)
  }

  const duplicate = () => duplicateMutation.mutate({ pageId: page.id })

  const handleArchive = () => archive.mutate({ id: page.id, workspaceId })

  const handleMakePrivate = () =>
    moveToCollection.mutate({ pageId: page.id, workspaceId, target: 'private' })

  const handleMoveToTeam = () =>
    moveToCollection.mutate({ pageId: page.id, workspaceId, target: 'team' })

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
    copyText,
    duplicate,
    openDeleteConfirm,
    handleArchive,
    handleMakePrivate,
    handleMoveToTeam,
    dialogs,
  }
}
