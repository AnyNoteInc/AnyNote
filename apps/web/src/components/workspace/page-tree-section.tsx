"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { Box, Typography, IconButton, AddIcon, MoreHorizIcon } from "@repo/ui/components"
import { trpc } from "@/trpc/client"
import { PageContextMenu } from "./page-context-menu"
import { MovePageDialog } from "./move-page-dialog"

type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
  createdAt: string | Date
}

type Props = {
  workspaceId: string
  pages: PageItem[]
  userId: string
  favoritePageIds: Set<string>
}

function orderSiblings(pages: PageItem[]): PageItem[] {
  if (pages.length === 0) return []
  const byPrev = new Map<string | null, PageItem>()
  for (const p of pages) byPrev.set(p.prevPageId, p)
  const out: PageItem[] = []
  let cursor: string | null = null
  while (byPrev.has(cursor)) {
    const next: PageItem = byPrev.get(cursor)!
    out.push(next)
    cursor = next.id
  }
  const inChain = new Set(out.map((p) => p.id))
  for (const p of pages) {
    if (!inChain.has(p.id)) out.push(p)
  }
  return out
}

function PageTreeItem({
  page,
  pages,
  workspaceId,
  userId,
  favoritePageIds,
  depth,
}: {
  page: PageItem
  pages: PageItem[]
  workspaceId: string
  userId: string
  favoritePageIds: Set<string>
  depth: number
}) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)

  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const children = orderSiblings(
    pages.filter((p) => p.parentId === page.id && p.parentType === "PAGE"),
  )

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          pr: 0.5,
          pl: depth * 1.5 + 0.5,
          borderRadius: 0.75,
          bgcolor: isActive ? "action.selected" : "transparent",
          "&:hover": { bgcolor: isActive ? "action.selected" : "action.hover" },
          "&:hover .page-actions": { visibility: "visible" },
        }}
      >
        <Link
          href={`/workspaces/${workspaceId}/pages/${page.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: "none", flex: 1, minWidth: 0, display: "flex", gap: 4 }}
        >
          <Typography
            variant="body2"
            component="span"
            sx={{ flexShrink: 0, lineHeight: "28px" }}
          >
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
                parentType: "PAGE",
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

      {children.map((child) => (
        <PageTreeItem
          key={child.id}
          page={child}
          pages={pages}
          workspaceId={workspaceId}
          userId={userId}
          favoritePageIds={favoritePageIds}
          depth={depth + 1}
        />
      ))}

      <PageContextMenu
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        page={page}
        workspaceId={workspaceId}
        userId={userId}
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

export function PageTreeSection({ workspaceId, pages: initialPages, userId, favoritePageIds }: Props) {
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

  const rootPages = orderSiblings(pages.filter((p) => p.parentType === "WORKSPACE"))

  return (
    <Box>
      <Typography variant="overline" sx={{ px: 1, color: "text.secondary" }}>
        Страницы
      </Typography>

      <Box sx={{ mt: 0.5 }}>
        {rootPages.map((page) => (
          <PageTreeItem
            key={page.id}
            page={page}
            pages={pages}
            workspaceId={workspaceId}
            userId={userId}
            favoritePageIds={favoritePageIds}
            depth={0}
          />
        ))}
      </Box>

      <Box
        component="button"
        onClick={() =>
          createPage.mutate({
            workspaceId,
            parentType: "WORKSPACE",
            parentId: null,
          })
        }
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          width: "100%",
          border: "none",
          background: "none",
          cursor: "pointer",
          color: "text.secondary",
          py: 0.5,
          px: 0.5,
          borderRadius: 0.75,
          fontSize: 13,
          "&:hover": { bgcolor: "action.hover", color: "text.primary" },
        }}
      >
        <AddIcon sx={{ fontSize: 16 }} />
        Новая страница
      </Box>
    </Box>
  )
}
