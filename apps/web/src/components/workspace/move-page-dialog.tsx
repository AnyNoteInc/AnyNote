"use client"

import { useState } from "react"

import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@repo/ui/components"
import { trpc } from "@/trpc/client"

import {
  PAGE_TREE_ROOT,
  PageTreePicker,
  getDescendantIds,
  type PageTreeSelection,
} from "./page-tree-picker"
import { type PageItem } from "./types"

type Props = {
  open: boolean
  onClose: () => void
  page: PageItem
  pages: PageItem[]
  workspaceId: string
}

export function MovePageDialog({ open, onClose, page, pages, workspaceId }: Props) {
  const utils = trpc.useUtils()
  const [selectedId, setSelectedId] = useState<PageTreeSelection | null>(null)

  const move = trpc.page.move.useMutation({
    onSuccess: async () => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      await utils.page.listFavorites.invalidate({ workspaceId })
      onClose()
    },
  })

  const excludeIds = new Set([page.id, ...getDescendantIds(page.id, pages)])

  const handleConfirm = () => {
    if (selectedId === null) return
    const newParentId = selectedId === PAGE_TREE_ROOT ? null : selectedId
    move.mutate({ pageId: page.id, newParentId })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Переместить \u00AB${page.title ?? "Новая страница"}\u00BB`}</DialogTitle>
      <DialogContent sx={{ p: 1 }}>
        <PageTreePicker
          pages={pages}
          excludeIds={excludeIds}
          onSelect={setSelectedId}
          selectedId={selectedId}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Отмена
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={selectedId === null || move.isPending}
        >
          Переместить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
