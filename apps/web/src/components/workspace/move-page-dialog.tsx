"use client"

import { useState } from "react"

import {
  Box,
  Button,
  ChevronRightIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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

function MoveTreeItem({
  page,
  pages,
  excludeIds,
  onSelect,
  selectedId,
  depth,
}: {
  page: PageItem
  pages: PageItem[]
  excludeIds: Set<string>
  onSelect: (id: string) => void
  selectedId: string | null
  depth: number
}) {
  const [expanded, setExpanded] = useState(false)
  const children = orderSiblings(
    pages.filter((p) => p.parentType === "PAGE" && p.parentId === page.id && !excludeIds.has(p.id)),
  )
  const isSelected = selectedId === page.id

  return (
    <>
      <Box
        onClick={() => onSelect(page.id)}
        sx={{
          display: "flex",
          alignItems: "center",
          pl: depth * 2 + 1,
          pr: 1,
          py: 0.5,
          cursor: "pointer",
          borderRadius: 0.75,
          ...(isSelected
            ? { bgcolor: "primary.main", color: "primary.contrastText" }
            : {}),
          "&:hover": { bgcolor: isSelected ? "primary.dark" : "action.hover" },
          fontSize: 13,
        }}
      >
        {children.length > 0 ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            sx={{ p: 0, mr: 0.5 }}
          >
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 0.15s",
              }}
            />
          </IconButton>
        ) : (
          <Box sx={{ width: 20, mr: 0.5 }} />
        )}
        <span style={{ marginRight: 6 }}>{page.icon ?? "📄"}</span>
        <Typography variant="body2" noWrap>
          {page.title ?? "Без названия"}
        </Typography>
      </Box>
      {expanded &&
        children.map((child) => (
          <MoveTreeItem
            key={child.id}
            page={child}
            pages={pages}
            excludeIds={excludeIds}
            onSelect={onSelect}
            selectedId={selectedId}
            depth={depth + 1}
          />
        ))}
    </>
  )
}

export function MovePageDialog({ open, onClose, page, pages, workspaceId }: Props) {
  const utils = trpc.useUtils()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const move = trpc.page.move.useMutation({
    onSuccess: async () => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      await utils.page.listFavorites.invalidate({ workspaceId })
      onClose()
    },
  })

  const excludeIds = new Set([page.id, ...getDescendantIds(page.id, pages)])
  const rootPages = orderSiblings(
    pages.filter((p) => p.parentType === "WORKSPACE" && !excludeIds.has(p.id)),
  )

  const handleConfirm = () => {
    if (selectedId === null) return
    const newParentId = selectedId === "__root__" ? null : selectedId
    move.mutate({ pageId: page.id, newParentId })
  }

  const selectedSx = { bgcolor: "primary.main", color: "primary.contrastText" } as const

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Переместить \u00AB${page.title ?? "Без названия"}\u00BB`}</DialogTitle>
      <DialogContent sx={{ p: 1 }}>
        <Box
          onClick={() => setSelectedId("__root__")}
          sx={{
            display: "flex",
            alignItems: "center",
            px: 1,
            py: 0.5,
            cursor: "pointer",
            borderRadius: 0.75,
            fontWeight: 500,
            fontSize: 13,
            ...(selectedId === "__root__" ? selectedSx : {}),
            "&:hover": { bgcolor: selectedId === "__root__" ? "primary.dark" : "action.hover" },
          }}
        >
          Корень
        </Box>
        {rootPages.map((p) => (
          <MoveTreeItem
            key={p.id}
            page={p}
            pages={pages}
            excludeIds={excludeIds}
            onSelect={setSelectedId}
            selectedId={selectedId}
            depth={0}
          />
        ))}
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
