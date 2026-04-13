"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  IconButton,
  MoreHorizIcon,
  Stack,
} from "@repo/ui/components"

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
  allPages: PageItem[]
  userId: string
  favoritePageIds: Set<string>
}

export function FavoritesSection({ workspaceId, allPages, userId, favoritePageIds }: Props) {
  const [open, setOpen] = useState(true)
  const pathname = usePathname()
  const favorites = trpc.page.listFavorites.useQuery({ workspaceId })

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuPage, setMenuPage] = useState<PageItem | null>(null)
  const [movePage, setMovePage] = useState<PageItem | null>(null)

  if (!favorites.data?.length && !favoritePageIds.size) return null

  const favPages = favorites.data ?? []

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>, page: PageItem) => {
    event.preventDefault()
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setMenuPage(page)
  }

  const handleCloseMenu = () => {
    setMenuAnchor(null)
    setMenuPage(null)
  }

  const childrenOf = (parentId: string) =>
    allPages.filter((p) => p.parentId === parentId && p.parentType === "PAGE")

  return (
    <Box>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.75,
          cursor: "pointer",
          color: "text.secondary",
          "&:hover": { color: "text.primary" },
        }}
      >
        <span style={{ fontSize: 13, flex: 1 }}>Избранное</span>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
      </Box>

      {open ? (
        <Stack spacing={0.25}>
          {favPages.map((fav) => {
            const page = allPages.find((p) => p.id === fav.id) ?? {
              ...fav,
              prevPageId: null,
              createdById: null,
              createdAt: new Date(),
            }
            return (
              <Box key={fav.id}>
                <FavItem
                  page={page}
                  workspaceId={workspaceId}
                  pathname={pathname}
                  onOpenMenu={handleOpenMenu}
                />
                {childrenOf(fav.id).map((child) => (
                  <FavItem
                    key={child.id}
                    page={child}
                    workspaceId={workspaceId}
                    pathname={pathname}
                    onOpenMenu={handleOpenMenu}
                    indent
                  />
                ))}
              </Box>
            )
          })}
        </Stack>
      ) : null}

      {menuPage ? (
        <PageContextMenu
          anchorEl={menuAnchor}
          onClose={handleCloseMenu}
          page={menuPage}
          workspaceId={workspaceId}
          userId={userId}
          isFavorite={true}
          onOpenMoveDialog={() => {
            setMovePage(menuPage)
            handleCloseMenu()
          }}
        />
      ) : null}

      {movePage ? (
        <MovePageDialog
          open={!!movePage}
          onClose={() => setMovePage(null)}
          page={movePage}
          pages={allPages}
          workspaceId={workspaceId}
        />
      ) : null}
    </Box>
  )
}

function FavItem({
  page,
  workspaceId,
  pathname,
  onOpenMenu,
  indent,
}: {
  page: PageItem
  workspaceId: string
  pathname: string
  onOpenMenu: (event: React.MouseEvent<HTMLElement>, page: PageItem) => void
  indent?: boolean
}) {
  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  return (
    <Box
      component={Link}
      href={`/workspaces/${workspaceId}/pages/${page.id}`}
      sx={{
        display: "flex",
        alignItems: "center",
        pr: 0.5,
        pl: indent ? 3 : 1,
        py: 0.5,
        borderRadius: 0.75,
        textDecoration: "none",
        color: "text.secondary",
        bgcolor: isActive ? "action.selected" : "transparent",
        "&:hover": { bgcolor: isActive ? "action.selected" : "action.hover" },
        "&:hover .fav-more": { visibility: "visible" },
        fontSize: 13,
      }}
    >
      <span style={{ fontSize: 14, marginRight: 8 }}>{page.icon ?? "📄"}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {page.title ?? "Без названия"}
      </span>
      <IconButton
        size="small"
        className="fav-more"
        onClick={(e) => onOpenMenu(e, page)}
        sx={{ visibility: "hidden", flexShrink: 0, p: 0.25 }}
      >
        <MoreHorizIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  )
}
