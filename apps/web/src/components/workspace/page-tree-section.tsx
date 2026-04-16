"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  Typography,
  IconButton,
  AddIcon,
  MoreHorizIcon,
  ChevronRightIcon,
} from "@repo/ui/components"
import { trpc } from "@/trpc/client"
import { PageContextMenu } from "./page-context-menu"
import { MovePageDialog } from "./move-page-dialog"
import { type PageItem, orderSiblings } from "./types"

type Props = {
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
}

function PageTreeItem({
  page,
  pages,
  workspaceId,
  favoritePageIds,
  depth,
}: {
  page: PageItem
  pages: PageItem[]
  workspaceId: string
  favoritePageIds: Set<string>
  depth: number
}) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)

  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const children = orderSiblings(pages.filter((p) => p.parentId === page.id))

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          pr: 0.5,
          pl: depth * 1.5,
          borderRadius: 0.75,
          bgcolor: isActive ? "action.selected" : "transparent",
          "&:hover": { bgcolor: isActive ? "action.selected" : "action.hover" },
          "&:hover .page-actions": { visibility: "visible" },
        }}
      >
        {children.length > 0 ? (
          <IconButton size="small" onClick={() => setExpanded((v) => !v)} sx={{ p: 0, mr: 0.25 }}>
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 0.15s",
              }}
            />
          </IconButton>
        ) : (
          <Box sx={{ width: 20 }} />
        )}
        <Link
          href={`/workspaces/${workspaceId}/pages/${page.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: "none", flex: 1, minWidth: 0, display: "flex", gap: 4 }}
        >
          <Typography variant="body2" component="span" sx={{ flexShrink: 0, lineHeight: "28px" }}>
            {page.icon ?? "📄"}
          </Typography>
          <Typography
            variant="body2"
            noWrap
            sx={{
              py: 0.5,
              color: isActive ? "text.primary" : "text.secondary",
            }}
          >
            {page.title ?? "Без названия"}
          </Typography>
        </Link>
        <Box
          className="page-actions"
          sx={{
            display: "flex",
            visibility: menuAnchor ? "visible" : "hidden",
            flexShrink: 0,
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              createPage.mutate({
                workspaceId,
                parentId: page.id,
              })
            }}
            sx={{ p: 0.25 }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setMenuAnchor(e.currentTarget as HTMLElement)
            }}
            sx={{ p: 0.25 }}
          >
            <MoreHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      {expanded &&
        children.map((child) => (
          <PageTreeItem
            key={child.id}
            page={child}
            pages={pages}
            workspaceId={workspaceId}
            favoritePageIds={favoritePageIds}
            depth={depth + 1}
          />
        ))}

      <PageContextMenu
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        page={page}
        workspaceId={workspaceId}
        isFavorite={favoritePageIds.has(page.id)}
        onOpenMoveDialog={() => {
          setMenuAnchor(null)
          setMoveOpen(true)
        }}
      />

      <MovePageDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        page={page}
        pages={pages}
        workspaceId={workspaceId}
      />
    </>
  )
}

export function PageTreeSection({ workspaceId, pages: initialPages, favoritePageIds }: Props) {
  const [open, setOpen] = useState(true)
  const router = useRouter()
  const utils = trpc.useUtils()

  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const pages = pagesQuery.data ?? initialPages

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const rootPages = orderSiblings(pages.filter((p) => p.parentId === null))

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 0.75,
        }}
      >
        <Box
          onClick={() => setOpen((prev) => !prev)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flex: 1,
            cursor: "pointer",
            color: "text.secondary",
            "&:hover": { color: "text.primary" },
          }}
        >
          <Typography variant="overline" sx={{ color: "inherit", letterSpacing: "0.06em" }}>
            Страницы
          </Typography>
          {open ? (
            <ArrowDropUpIcon sx={{ fontSize: 16 }} />
          ) : (
            <ArrowDropDownIcon sx={{ fontSize: 16 }} />
          )}
        </Box>
        <IconButton
          size="small"
          onClick={() =>
            createPage.mutate({
              workspaceId,
              parentId: null,
            })
          }
          sx={{ p: 0.25 }}
        >
          <AddIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        </IconButton>
      </Box>

      {open ? (
        <Box sx={{ maxHeight: 300, overflow: "auto" }}>
          {rootPages.map((page) => (
            <PageTreeItem
              key={page.id}
              page={page}
              pages={pages}
              workspaceId={workspaceId}
              favoritePageIds={favoritePageIds}
              depth={0}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
