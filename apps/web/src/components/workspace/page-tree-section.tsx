'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AccountTreeIcon,
  AddIcon,
  Box,
  BrushIcon,
  ChevronRightIcon,
  DescriptionIcon,
  DragIndicatorIcon,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreHorizIcon,
  SchemaIcon,
  Typography,
  ViewKanbanIcon,
} from '@repo/ui/components'
import type { PageType } from '@repo/db'
import { trpc } from '@/trpc/client'
import { PageContextMenu } from './page-context-menu'
import { MovePageDialog } from './move-page-dialog'
import { type FlatPageItem, type PageItem, flattenTree } from './types'

type CreatablePageType = Extract<
  PageType,
  'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'LIKEC4' | 'DRAWIO' | 'KANBAN'
>

type Props = {
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
}

function DiagramSubmenu({
  onCreate,
  onClose,
}: {
  onCreate: (type: CreatablePageType) => void
  onClose: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const choose = (type: CreatablePageType) => {
    onCreate(type)
    setAnchor(null)
    onClose()
  }
  return (
    <>
      <MenuItem onClick={(e) => setAnchor(e.currentTarget)}>
        <ListItemIcon>
          <SchemaIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Диаграмма" />
        <ChevronRightIcon fontSize="small" sx={{ ml: 'auto', color: 'text.secondary' }} />
      </MenuItem>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem onClick={() => choose('MERMAID')}>
          <ListItemIcon>
            <SchemaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="MermaidJS" />
        </MenuItem>
        <MenuItem onClick={() => choose('PLANTUML')}>
          <ListItemIcon>
            <SchemaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="PlantUML" />
        </MenuItem>
        <MenuItem onClick={() => choose('LIKEC4')}>
          <ListItemIcon>
            <SchemaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="LikeC4" />
        </MenuItem>
      </Menu>
    </>
  )
}

function HolstSubmenu({
  onCreate,
  onClose,
}: {
  onCreate: (type: CreatablePageType) => void
  onClose: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const choose = (type: CreatablePageType) => {
    onCreate(type)
    setAnchor(null)
    onClose()
  }
  return (
    <>
      <MenuItem onClick={(e) => setAnchor(e.currentTarget)}>
        <ListItemIcon>
          <BrushIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Холст" />
        <ChevronRightIcon fontSize="small" sx={{ ml: 'auto', color: 'text.secondary' }} />
      </MenuItem>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem onClick={() => choose('EXCALIDRAW')}>
          <ListItemIcon>
            <BrushIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Excalidraw" />
        </MenuItem>
        <MenuItem onClick={() => choose('DRAWIO')}>
          <ListItemIcon>
            <SchemaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Draw.io" />
        </MenuItem>
      </Menu>
    </>
  )
}

function CreatePageMenu({
  anchorEl,
  onClose,
  onCreate,
}: {
  anchorEl: HTMLElement | null
  onClose: () => void
  onCreate: (type: CreatablePageType) => void
}) {
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem
        onClick={() => {
          onCreate('TEXT')
          onClose()
        }}
      >
        <ListItemIcon>
          <DescriptionIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Текст" />
      </MenuItem>
      <HolstSubmenu onCreate={onCreate} onClose={onClose} />
      <MenuItem
        onClick={() => {
          onCreate('GENOGRAM')
          onClose()
        }}
      >
        <ListItemIcon>
          <AccountTreeIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Генограмма" />
      </MenuItem>
      <MenuItem
        onClick={() => {
          onCreate('KANBAN')
          onClose()
        }}
      >
        <ListItemIcon>
          <ViewKanbanIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Канбан" />
      </MenuItem>
      <DiagramSubmenu onCreate={onCreate} onClose={onClose} />
    </Menu>
  )
}

function DropLine({ depth }: { depth: number }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        left: 4 + depth * 24,
        right: 4,
        height: 2,
        borderRadius: 1,
        bgcolor: 'primary.main',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  )
}

function SortablePageRow({
  item,
  workspaceId,
  pages,
  favoritePageIds,
  showDropBefore,
  showDropAfter,
  onToggleCollapse,
}: {
  item: FlatPageItem
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
  showDropBefore: boolean
  showDropAfter: boolean
  onToggleCollapse: (id: string) => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)

  const isCurrentPage = pathname === `/workspaces/${workspaceId}/pages/${item.id}`
  const hasChildren = pages.some((p) => p.parentId === item.id)

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative' as const,
  }

  return (
    <Box ref={setNodeRef} style={style} data-page-row={item.id}>
      {showDropBefore && <DropLine depth={item.depth} />}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pr: 0.5,
          pl: 0.5 + item.depth * 1.5,
          borderRadius: 0.75,
          bgcolor: isCurrentPage ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: isCurrentPage ? 'action.selected' : 'action.hover' },
          '&:hover .page-actions': { visibility: 'visible' },
          '&:hover .drag-handle': { visibility: 'visible' },
        }}
      >
        <Box
          ref={setActivatorNodeRef}
          className="drag-handle"
          {...attributes}
          {...listeners}
          data-drag-handle={item.id}
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

        {hasChildren ? (
          <IconButton size="small" onClick={() => onToggleCollapse(item.id)} sx={{ p: 0, mr: 0.25 }}>
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                transform: item.collapsed ? 'none' : 'rotate(90deg)',
                transition: 'transform 0.15s',
              }}
            />
          </IconButton>
        ) : null}

        <Link
          href={`/workspaces/${workspaceId}/pages/${item.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: 'none', flex: 1, minWidth: 0, display: 'flex', gap: 4 }}
        >
          {item.icon ? (
            <Typography variant="body2" component="span" sx={{ flexShrink: 0, lineHeight: '28px' }}>
              {item.icon}
            </Typography>
          ) : null}
          <Typography
            variant="body2"
            noWrap
            sx={{ py: 0.5, color: isCurrentPage ? 'text.primary' : 'text.secondary' }}
          >
            {item.title ?? 'Новая страница'}
          </Typography>
        </Link>

        <Box
          className="page-actions"
          sx={{
            display: 'flex',
            visibility: menuAnchor || createAnchor ? 'visible' : 'hidden',
            flexShrink: 0,
          }}
        >
          <IconButton
            size="small"
            onClick={(e: MouseEvent<HTMLElement>) => {
              e.stopPropagation()
              setCreateAnchor(e.currentTarget)
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
      {showDropAfter && <DropLine depth={item.depth} />}

      <CreatePageMenu
        anchorEl={createAnchor}
        onClose={() => setCreateAnchor(null)}
        onCreate={(type) => createPage.mutate({ workspaceId, parentId: item.id, type })}
      />
      <PageContextMenu
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        page={item}
        workspaceId={workspaceId}
        isFavorite={favoritePageIds.has(item.id)}
        onOpenMoveDialog={() => {
          setMenuAnchor(null)
          setMoveOpen(true)
        }}
      />
      <MovePageDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        page={item}
        pages={pages}
        workspaceId={workspaceId}
      />
    </Box>
  )
}

export function PageTreeSection({ workspaceId, pages: initialPages, favoritePageIds }: Props) {
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const router = useRouter()
  const utils = trpc.useUtils()

  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const pages = pagesQuery.data ?? initialPages

  const reorder = trpc.page.reorder.useMutation({
    onError: () => {
      utils.page.listByWorkspace.invalidate({ workspaceId })
    },
  })

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const flatItems = useMemo(
    () => flattenTree(pages, null, 0, collapsedIds),
    [pages, collapsedIds],
  )

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(active.id as string)
  }

  function onDragOver({ over }: DragOverEvent) {
    setOverId((over?.id as string | undefined) ?? null)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    setOverId(null)

    if (!over || active.id === over.id) return

    const activeIdx = flatItems.findIndex((i) => i.id === active.id)
    const overIdx = flatItems.findIndex((i) => i.id === over.id)
    if (activeIdx === -1 || overIdx === -1) return

    const overItem = flatItems[overIdx]
    const draggedActiveId = active.id as string
    const draggedPage = pages.find((p) => p.id === draggedActiveId)
    if (!draggedPage || !overItem) return

    // Dropping before overItem if dragging upward (activeIdx > overIdx), else after
    const droppingBefore = activeIdx > overIdx
    const newParentId = overItem.parentId
    const newPrevPageId = droppingBefore ? overItem.prevPageId : overItem.id

    if (draggedPage.parentId === newParentId && draggedPage.prevPageId === newPrevPageId) return

    utils.page.listByWorkspace.setData({ workspaceId }, (old) => {
      if (!old) return old
      const currentNextSiblingId = old.find((p) => p.prevPageId === draggedActiveId)?.id
      const pageAtInsertPointId = old.find(
        (p) =>
          p.prevPageId === newPrevPageId &&
          p.parentId === newParentId &&
          p.id !== draggedActiveId,
      )?.id
      return old.map((p) => {
        if (p.id === draggedActiveId)
          return { ...p, parentId: newParentId, prevPageId: newPrevPageId }
        if (currentNextSiblingId && p.id === currentNextSiblingId)
          return { ...p, prevPageId: draggedPage.prevPageId }
        if (pageAtInsertPointId && p.id === pageAtInsertPointId)
          return { ...p, prevPageId: draggedActiveId }
        return p
      })
    })

    reorder.mutate({ pageId: draggedActiveId, newParentId, newPrevPageId })
  }

  const activeItem = activeId ? (flatItems.find((i) => i.id === activeId) ?? null) : null
  const activeIdx = activeId ? flatItems.findIndex((i) => i.id === activeId) : -1
  const overIdx = overId ? flatItems.findIndex((i) => i.id === overId) : -1

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: 1,
        }}
      >
        <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.06em' }}>
          Страницы
        </Typography>
        <IconButton
          aria-label="Новая страница"
          size="small"
          onClick={(e: MouseEvent<HTMLElement>) => setCreateAnchor(e.currentTarget)}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <CreatePageMenu
          anchorEl={createAnchor}
          onClose={() => setCreateAnchor(null)}
          onCreate={(type) => createPage.mutate({ workspaceId, parentId: null, type })}
        />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={flatItems.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {flatItems.map((item, idx) => (
              <SortablePageRow
                key={item.id}
                item={item}
                workspaceId={workspaceId}
                pages={pages}
                favoritePageIds={favoritePageIds}
                showDropBefore={activeId !== null && overIdx === idx && activeIdx > idx}
                showDropAfter={activeId !== null && overIdx === idx && activeIdx < idx}
                onToggleCollapse={toggleCollapse}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeItem ? (
              <Box
                sx={{
                  pl: 0.5 + activeItem.depth * 1.5,
                  py: 0.5,
                  borderRadius: 0.75,
                  bgcolor: 'background.paper',
                  boxShadow: 3,
                  opacity: 0.9,
                }}
              >
                <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                  {activeItem.icon ? `${activeItem.icon} ` : ''}
                  {activeItem.title ?? 'Новая страница'}
                </Typography>
              </Box>
            ) : null}
          </DragOverlay>
        </DndContext>
      </Box>
    </Box>
  )
}
