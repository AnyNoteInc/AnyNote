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

type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

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

function orderSiblings(siblings: PageItem[]): PageItem[] {
  if (siblings.length === 0) return []

  const byPrev = new Map<string | null, PageItem>()
  for (const s of siblings) {
    byPrev.set(s.prevPageId, s)
  }

  const ordered: PageItem[] = []
  const visited = new Set<string>()

  let current = byPrev.get(null)
  while (current && !visited.has(current.id)) {
    ordered.push(current)
    visited.add(current.id)
    current = byPrev.get(current.id)
  }

  // Append orphans not reached by the chain
  for (const s of siblings) {
    if (!visited.has(s.id)) {
      ordered.push(s)
    }
  }

  return ordered
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
              <Typography component="span">{p.title ?? "Untitled"}</Typography>
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
      <DialogTitle>{`Переместить \u00AB${page.title ?? "Untitled"}\u00BB`}</DialogTitle>
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
