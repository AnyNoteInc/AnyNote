"use client"

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  SimpleTreeView,
  TreeItem,
  Typography,
} from "@repo/ui/components"
import { trpc } from "@/trpc/client"
import { type PageItem, orderSiblings } from "./types"

type Props = {
  open: boolean
  onClose: () => void
  page: PageItem
  pages: PageItem[]
  workspaceId: string
}

function getDescendantIds(pageId: string, pages: PageItem[]): Set<string> {
  const ids = new Set<string>()
  const queue = [pageId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const p of pages) {
      if (p.parentType === "PAGE" && p.parentId === current && !ids.has(p.id)) {
        ids.add(p.id)
        queue.push(p.id)
      }
    }
  }
  return ids
}

function PageTreeItems({
  parentId,
  parentType,
  pages,
  excludeIds,
  onSelect,
}: {
  parentId: string | null
  parentType: string
  pages: PageItem[]
  excludeIds: Set<string>
  onSelect: (itemId: string) => void
}) {
  const siblings = pages.filter(
    (p) => p.parentType === parentType && p.parentId === parentId && !excludeIds.has(p.id),
  )
  const ordered = orderSiblings(siblings)

  return (
    <>
      {ordered.map((p) => (
        <TreeItem
          key={p.id}
          itemId={p.id}
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {p.icon && <Typography component="span">{p.icon}</Typography>}
              <Typography component="span">{p.title ?? "Без названия"}</Typography>
            </Box>
          }
          onClick={(e) => {
            e.stopPropagation()
            onSelect(p.id)
          }}
        >
          <PageTreeItems
            parentId={p.id}
            parentType="PAGE"
            pages={pages}
            excludeIds={excludeIds}
            onSelect={onSelect}
          />
        </TreeItem>
      ))}
    </>
  )
}

export function MovePageDialog({ open, onClose, page, pages, workspaceId }: Props) {
  const utils = trpc.useUtils()

  const move = trpc.page.move.useMutation({
    onSuccess: async () => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      await utils.page.listFavorites.invalidate({ workspaceId })
      onClose()
    },
  })

  const excludeIds = new Set([page.id, ...getDescendantIds(page.id, pages)])

  const handleSelect = (itemId: string) => {
    const newParentId = itemId === "__root__" ? null : itemId
    move.mutate({ pageId: page.id, newParentId })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Переместить \u00AB${page.title ?? "Без названия"}\u00BB`}</DialogTitle>
      <DialogContent>
        <SimpleTreeView>
          <TreeItem
            itemId="__root__"
            label={<Typography>Корень</Typography>}
            onClick={(e) => {
              e.stopPropagation()
              handleSelect("__root__")
            }}
          />
          <PageTreeItems
            parentId={null}
            parentType="WORKSPACE"
            pages={pages}
            excludeIds={excludeIds}
            onSelect={handleSelect}
          />
        </SimpleTreeView>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
      </DialogActions>
    </Dialog>
  )
}
