'use client'

import { useEffect, useState, type MouseEvent } from 'react'
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
  IconButton,
  MoreHorizIcon,
  Stack,
  StarIcon,
  Typography,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'
import { PageIcon } from '@/components/page/page-icon'
import { PageContextMenu } from './page-context-menu'
import { MovePageDialog } from './move-page-dialog'
import type { PageItem } from './types'

type Props = {
  workspaceId: string
  allPages: PageItem[]
  favoritePageIds: Set<string>
}

function getAllDescendants(pageId: string, allPages: PageItem[]): PageItem[] {
  const result: PageItem[] = []
  const directChildren = allPages.filter((p) => p.parentId === pageId)
  for (const child of directChildren) {
    result.push(child)
    result.push(...getAllDescendants(child.id, allPages))
  }
  return result
}

type FavRowProps = {
  page: PageItem
  onOpenMenu: (event: MouseEvent<HTMLElement>, page: PageItem) => void
  setNodeRef?: (el: HTMLElement | null) => void
  style?: React.CSSProperties
  dragListeners?: Record<string, unknown>
}

function FavRowVisual({
  page,
  onOpenMenu,
  setNodeRef,
  style,
  dragListeners,
}: FavRowProps) {
  const pathname = usePathname()
  const isActive = pathname === `/pages/${page.id}`

  return (
    <Box
      ref={setNodeRef}
      data-fav-row={page.id}
      data-drag-handle={page.id}
      style={style}
      {...(dragListeners ?? {})}
      sx={{
        display: 'flex',
        alignItems: 'center',
        pr: 0.5,
        pl: 1,
        borderRadius: 0.75,
        color: 'text.secondary',
        cursor: 'grab',
        bgcolor: isActive ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: isActive ? 'action.selected' : 'action.hover' },
        '&:hover .fav-more': { visibility: 'visible' },
        '&:active': { cursor: 'grabbing' },
        fontSize: 13,
      }}
    >
      <Link
        href={`/pages/${page.id}`}
        onClick={(e) => e.stopPropagation()}
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
          <span style={{ marginRight: 8, flexShrink: 0, display: 'inline-flex' }}>
            <PageIcon icon={page.icon} size={14} />
          </span>
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
        onClick={(e) => {
          e.stopPropagation()
          onOpenMenu(e, page)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        sx={{ visibility: 'hidden', flexShrink: 0, p: 0.25 }}
      >
        <MoreHorizIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  )
}

function SortableFavItem(props: FavRowProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.page.id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <FavRowVisual
      {...props}
      setNodeRef={setNodeRef}
      style={style}
      dragListeners={listeners as unknown as Record<string, unknown>}
    />
  )
}

export function FavoritesSection({ workspaceId, allPages: initialPages, favoritePageIds }: Props) {
  const [open, setOpen] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuPage, setMenuPage] = useState<PageItem | null>(null)
  const [movePage, setMovePage] = useState<PageItem | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const favorites = trpc.page.listFavorites.useQuery({ workspaceId }, { enabled: mounted })
  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId }, { enabled: mounted })
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

  function resolvePage(fav: { id: string; title: string | null; icon: string | null }): PageItem {
    return (
      allPages.find((p) => p.id === fav.id) ?? {
        id: fav.id,
        title: fav.title,
        icon: fav.icon,
        parentId: null,
        prevPageId: null,
        createdById: null,
        createdAt: '',
      }
    )
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
        mounted ? (
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
              <Stack spacing={0.25}>
                {favPages.map((fav) => {
                  const page = resolvePage(fav)
                  const descendants = getAllDescendants(fav.id, allPages)
                  return (
                    <Box key={fav.id}>
                      <SortableFavItem page={page} onOpenMenu={handleOpenMenu} />
                      {descendants.map((child) => (
                        <Box key={child.id} sx={{ pl: 2 }}>
                          <FavRowVisual page={child} onOpenMenu={handleOpenMenu} />
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
                  {activeItem.icon ? (
                    <span
                      style={{ marginRight: 6, display: 'inline-flex', verticalAlign: 'middle' }}
                    >
                      <PageIcon icon={activeItem.icon} size={14} />
                    </span>
                  ) : null}
                  {activeItem.title ?? 'Новая страница'}
                </Box>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <Stack spacing={0.25}>
            {favPages.map((fav) => {
              const page = resolvePage(fav)
              const descendants = getAllDescendants(fav.id, allPages)
              return (
                <Box key={fav.id}>
                  <FavRowVisual page={page} onOpenMenu={handleOpenMenu} />
                  {descendants.map((child) => (
                    <Box key={child.id} sx={{ pl: 2 }}>
                      <FavRowVisual page={child} onOpenMenu={handleOpenMenu} />
                    </Box>
                  ))}
                </Box>
              )
            })}
          </Stack>
        )
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
