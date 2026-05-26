'use client'

import { useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  DragIndicatorIcon,
  IconButton,
  MoreHorizIcon,
  Stack,
  StarIcon,
  Typography,
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

function SortableFavItem({
  page,
  workspaceId,
  onOpenMenu,
}: {
  page: PageItem
  workspaceId: string
  onOpenMenu: (event: MouseEvent<HTMLElement>, page: PageItem) => void
}) {
  const pathname = usePathname()
  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id })

  return (
    <Box
      ref={setNodeRef}
      data-fav-row={page.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        pr: 0.5,
        pl: 1,
        borderRadius: 0.75,
        color: 'text.secondary',
        bgcolor: isActive ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: isActive ? 'action.selected' : 'action.hover' },
        '&:hover .fav-more': { visibility: 'visible' },
        '&:hover .fav-handle': { visibility: 'visible' },
        fontSize: 13,
      }}
    >
      <Box
        ref={setActivatorNodeRef}
        className="fav-handle"
        {...attributes}
        {...listeners}
        data-drag-handle={page.id}
        sx={{
          visibility: 'hidden',
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          color: 'text.disabled',
          mr: 0.25,
          flexShrink: 0,
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorIcon sx={{ fontSize: 14 }} />
      </Box>

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
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
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

export function FavoritesSection({ workspaceId, allPages: initialPages, favoritePageIds }: Props) {
  const [open, setOpen] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuPage, setMenuPage] = useState<PageItem | null>(null)
  const [movePage, setMovePage] = useState<PageItem | null>(null)

  const favorites = trpc.page.listFavorites.useQuery({ workspaceId })
  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const utils = trpc.useUtils()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const reorderFavorites = trpc.page.reorderFavorites.useMutation({
    onError: () => {
      void utils.page.listFavorites.invalidate({ workspaceId })
    },
  })

  const allPages = pagesQuery.data ?? initialPages
  const favPages = favorites.data ?? []
  const hasFavorites = favPages.length > 0 || favoritePageIds.size > 0

  if (!hasFavorites && favorites.isFetched) return null

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (!over || active.id === over.id) return

    const activeIdx = favPages.findIndex((p) => p.id === active.id)
    const overIdx = favPages.findIndex((p) => p.id === over.id)
    if (activeIdx === -1 || overIdx === -1) return

    const reordered = [...favPages]
    const [moved] = reordered.splice(activeIdx, 1)
    if (!moved) return
    reordered.splice(overIdx, 0, moved)
    const orderedIds = reordered.map((p) => p.id)

    utils.page.listFavorites.setData({ workspaceId }, reordered)
    reorderFavorites.mutate({ workspaceId, orderedIds })
  }

  const activeItem = activeId ? (favPages.find((p) => p.id === activeId) ?? null) : null

  const handleOpenMenu = (event: MouseEvent<HTMLElement>, page: PageItem) => {
    event.preventDefault()
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setMenuPage(page)
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
        <Typography
          variant="overline"
          sx={{ color: 'inherit', flex: 1, letterSpacing: '0.06em', lineHeight: 1.4 }}
        >
          ИЗБРАННОЕ
        </Typography>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
      </Box>

      {open ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) => setActiveId(active.id as string)}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={favPages.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
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
                    <SortableFavItem
                      page={page}
                      workspaceId={workspaceId}
                      onOpenMenu={handleOpenMenu}
                    />
                    {descendants.map((child) => (
                      <Box key={child.id} sx={{ pl: 2 }}>
                        <SortableFavItem
                          page={child}
                          workspaceId={workspaceId}
                          onOpenMenu={handleOpenMenu}
                        />
                      </Box>
                    ))}
                  </Box>
                )
              })}
            </Stack>
          </SortableContext>
          <DragOverlay>
            {activeItem ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.5,
                  borderRadius: 0.75,
                  bgcolor: 'background.paper',
                  boxShadow: 3,
                  opacity: 0.9,
                  fontSize: 13,
                  color: 'text.secondary',
                }}
              >
                {activeItem.icon ? `${activeItem.icon} ` : ''}
                {activeItem.title ?? 'Новая страница'}
              </Box>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}

      {menuPage ? (
        <PageContextMenu
          anchorEl={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          page={menuPage}
          workspaceId={workspaceId}
          isFavorite={favoritePageIds.has(menuPage.id)}
          onOpenMoveDialog={() => {
            setMovePage(menuPage)
            setMenuAnchor(null)
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
