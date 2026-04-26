'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  IconButton,
  MoreHorizIcon,
  Stack,
  StarIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { PageContextMenu } from './page-context-menu'
import { MovePageDialog } from './move-page-dialog'
import type { PageItem } from './types'

type Props = {
  workspaceId: string
  allPages: PageItem[]
  favoritePageIds: Set<string>
}

/** Recursively collect all descendants of a page */
function getAllDescendants(pageId: string, allPages: PageItem[]): PageItem[] {
  const result: PageItem[] = []
  const directChildren = allPages.filter((p) => p.parentId === pageId)
  for (const child of directChildren) {
    result.push(child)
    result.push(...getAllDescendants(child.id, allPages))
  }
  return result
}

export function FavoritesSection({ workspaceId, allPages: initialPages, favoritePageIds }: Props) {
  const [open, setOpen] = useState(true)
  const pathname = usePathname()
  const favorites = trpc.page.listFavorites.useQuery({ workspaceId })
  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const allPages = pagesQuery.data ?? initialPages

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuPage, setMenuPage] = useState<PageItem | null>(null)
  const [movePage, setMovePage] = useState<PageItem | null>(null)

  const favPages = favorites.data ?? []
  const hasFavorites = favPages.length > 0 || favoritePageIds.size > 0
  if (!hasFavorites && favorites.isFetched) return null

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>, page: PageItem) => {
    event.preventDefault()
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setMenuPage(page)
  }

  const handleCloseMenu = () => {
    setMenuAnchor(null)
  }

  return (
    <Box>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.75,
          cursor: 'pointer',
          color: 'text.secondary',
          '&:hover': { color: 'text.primary' },
        }}
      >
        <StarIcon sx={{ fontSize: 16 }} />
        <span style={{ fontSize: 13, flex: 1 }}>Избранное</span>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
      </Box>

      {open ? (
        <Stack spacing={0.25} sx={{ maxHeight: 200, overflow: 'auto' }}>
          {favPages.map((fav) => {
            const page = allPages.find((p) => p.id === fav.id) ?? {
              ...fav,
              prevPageId: null,
              createdById: null,
              createdAt: new Date(),
            }
            const descendants = getAllDescendants(fav.id, allPages)
            return (
              <Box key={fav.id}>
                <FavItem
                  page={page}
                  workspaceId={workspaceId}
                  pathname={pathname}
                  onOpenMenu={handleOpenMenu}
                  isFavorite={favoritePageIds.has(page.id)}
                />
                {descendants.map((child) => (
                  <FavItem
                    key={child.id}
                    page={child}
                    workspaceId={workspaceId}
                    pathname={pathname}
                    onOpenMenu={handleOpenMenu}
                    indent
                    isFavorite={favoritePageIds.has(child.id)}
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
          isFavorite={favoritePageIds.has(menuPage.id)}
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
  isFavorite: boolean
}) {
  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        pr: 0.5,
        pl: indent ? 3 : 1,
        borderRadius: 0.75,
        color: indent ? 'text.disabled' : 'text.secondary',
        bgcolor: isActive ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: isActive ? 'action.selected' : 'action.hover' },
        '&:hover .fav-more': { visibility: 'visible' },
        fontSize: 13,
      }}
    >
      <Link
        href={`/workspaces/${workspaceId}/pages/${page.id}`}
        style={{
          textDecoration: 'none',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        {page.icon ? (
          <span style={{ fontSize: 14, marginRight: 8, flexShrink: 0 }}>{page.icon}</span>
        ) : null}
        <span
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {page.title ?? 'Новая страница'}
        </span>
      </Link>
      <IconButton
        size="small"
        className="fav-more"
        onClick={(e) => onOpenMenu(e, page)}
        sx={{ visibility: 'hidden', flexShrink: 0, p: 0.25 }}
      >
        <MoreHorizIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  )
}
