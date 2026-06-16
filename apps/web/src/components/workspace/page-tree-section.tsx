'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import type { Active, Over } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AddIcon,
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  ChevronRightIcon,
  IconButton,
  MoreHorizIcon,
  Typography,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'
import { CreatePageDialog, useCreatePageFlow } from '@/components/templates'
import { MeetingUploadDialog } from '@/components/meeting/MeetingUploadDialog'
import { PageIcon } from '@/components/page/page-icon'
import { PageContextMenu } from './page-context-menu'
import { MovePageDialog } from './move-page-dialog'
import {
  SIDEBAR_ZONES,
  SidebarDropZone,
  useRegisterMoveInto,
  useRegisterReorder,
  useSidebarDnd,
} from './sidebar-dnd-context'
import type { SidebarDragData } from './sidebar-dnd-context'
import { type FlatPageItem, type PageItem, flattenTree } from './types'

type Props = {
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
  collectionId?: string | null
  title?: string
  /** Collection kind this section represents, so the root "+" creates in the right place. */
  location?: 'team' | 'private'
  /** Optional leading icon, so the section reads as a first-level sidebar tree root. */
  headerIcon?: ReactNode
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

type RowVisualProps = {
  item: FlatPageItem
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
  showDropBefore: boolean
  showDropAfter: boolean
  onToggleCollapse: (id: string) => void
}

function PageRowVisual({
  item,
  workspaceId,
  pages,
  favoritePageIds,
  showDropBefore,
  showDropAfter,
  onToggleCollapse,
  setNodeRef,
  style,
  dragListeners,
}: RowVisualProps & {
  setNodeRef?: (el: HTMLElement | null) => void
  style?: React.CSSProperties
  dragListeners?: Record<string, unknown>
}) {
  const pathname = usePathname()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const createFlow = useCreatePageFlow(workspaceId)

  const isCurrentPage = pathname === `/pages/${item.id}`
  const hasChildren = pages.some((p) => p.parentId === item.id)

  return (
    <Box
      ref={setNodeRef}
      style={style}
      data-page-row={item.id}
      data-drag-handle={item.id}
      {...(dragListeners ?? {})}
      sx={{ position: 'relative' }}
    >
      {showDropBefore && <DropLine depth={item.depth} />}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pr: 0.5,
          pl: 0.5 + item.depth * 1.5,
          borderRadius: 0.75,
          cursor: 'grab',
          bgcolor: isCurrentPage ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: isCurrentPage ? 'action.selected' : 'action.hover' },
          '&:hover .page-actions': { visibility: 'visible' },
          '&:active': { cursor: 'grabbing' },
        }}
      >
        {hasChildren ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapse(item.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            sx={{ p: 0, mr: 0.25 }}
          >
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
          href={`/pages/${item.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: 'none', flex: 1, minWidth: 0, display: 'flex', gap: 4 }}
        >
          {item.icon ? (
            <Box
              component="span"
              sx={{ flexShrink: 0, height: 28, display: 'inline-flex', alignItems: 'center' }}
            >
              <PageIcon icon={item.icon} size={16} />
            </Box>
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
            visibility: menuAnchor || createFlow.open ? 'visible' : 'hidden',
            flexShrink: 0,
          }}
        >
          <IconButton
            size="small"
            aria-label="Создать вложенную страницу"
            onClick={(e: MouseEvent<HTMLElement>) => {
              e.stopPropagation()
              createFlow.openFor(item.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
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
            onPointerDown={(e) => e.stopPropagation()}
            sx={{ p: 0.25 }}
          >
            <MoreHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>
      {showDropAfter && <DropLine depth={item.depth} />}

      <CreatePageDialog
        open={createFlow.open}
        onClose={createFlow.close}
        workspaceId={workspaceId}
        onCreatePage={createFlow.handleCreatePage}
        onCreateFromTemplate={createFlow.handleCreateFromTemplate}
        onCreateDashboard={createFlow.handleCreateDashboard}
        onUploadMeeting={createFlow.openMeetingUpload}
        meetingsEnabled={createFlow.meetingsEnabled}
        isCreating={createFlow.isCreating}
      />
      <MeetingUploadDialog
        open={createFlow.meetingOpen}
        onClose={createFlow.closeMeetingUpload}
        workspaceId={workspaceId}
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

function SortablePageRow({
  section,
  moveTarget,
  ...props
}: RowVisualProps & { section: string; moveTarget: 'team' | 'private' | null }) {
  const data: SidebarDragData = {
    kind: 'page',
    pageId: props.item.id,
    section,
    moveTarget,
    title: props.item.title,
    icon: props.item.icon,
  }
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
    data,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
  }
  return (
    <PageRowVisual
      {...props}
      setNodeRef={setNodeRef}
      style={style}
      dragListeners={listeners as unknown as Record<string, unknown>}
    />
  )
}

export function PageTreeSection({
  workspaceId,
  pages: initialPages,
  favoritePageIds,
  collectionId,
  title,
  location,
  headerIcon,
}: Props) {
  const [sectionOpen, setSectionOpen] = useState(true)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [mounted, setMounted] = useState(false)
  const utils = trpc.useUtils()
  // Dashboard create and the «Загрузить встречу» upload now live in the unified
  // "+" create flow (see use-create-page-flow); this section just hosts the
  // entry points via `createFlow`.
  const createFlow = useCreatePageFlow(workspaceId)
  // Drag state is owned by the single hoisted DndContext (sidebar-dnd-context);
  // this section just reads the active/over ids to paint its own drop lines.
  const { activeId, overId } = useSidebarDnd()
  // Stable section id so the shared onDragEnd can delegate a non-zone reorder
  // back to THIS tree's reorder logic.
  const sectionId = collectionId ?? location ?? 'pages'

  useEffect(() => {
    setMounted(true)
  }, [])

  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId }, { enabled: mounted })
  const allPages = pagesQuery.data ?? initialPages
  const pages = useMemo(
    () =>
      collectionId === undefined
        ? allPages
        : allPages.filter((p) => p.collectionId === collectionId),
    [allPages, collectionId],
  )

  const reorder = trpc.page.reorder.useMutation({
    onError: () => {
      void utils.page.listByWorkspace.invalidate({ workspaceId })
    },
  })

  // Cross-collection move INTO this section. Deliberately does NOT refetch on
  // success: the optimistic splice below is the authoritative state, so the
  // moved page lands in place instantly with no vanish-then-reappear blink.
  // Roll back only on a real server error.
  const moveInto = trpc.page.moveToCollection.useMutation({
    onError: () => {
      void utils.page.listByWorkspace.invalidate({ workspaceId })
    },
  })

  const flatItems = useMemo(() => flattenTree(pages, null, 0, collapsedIds), [pages, collapsedIds])

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Reorder-within-this-tree. Registered with the shared DndContext, which
  // calls it for a non-zone drop whose dragged row belongs to this section.
  function reorderHandler(active: Active, over: Over) {
    if (active.id === over.id) return

    const fromIdx = flatItems.findIndex((i) => i.id === active.id)
    const toIdx = flatItems.findIndex((i) => i.id === over.id)
    if (fromIdx === -1 || toIdx === -1) return

    const overItem = flatItems[toIdx]
    const draggedActiveId = active.id as string
    const draggedPage = pages.find((p) => p.id === draggedActiveId)
    if (!draggedPage || !overItem) return

    const droppingBefore = fromIdx > toIdx
    const newParentId = overItem.parentId
    const newPrevPageId = droppingBefore ? overItem.prevPageId : overItem.id

    if (draggedPage.parentId === newParentId && draggedPage.prevPageId === newPrevPageId) return

    utils.page.listByWorkspace.setData({ workspaceId }, (old) => {
      if (!old) return old
      const currentNextSiblingId = old.find((p) => p.prevPageId === draggedActiveId)?.id
      const pageAtInsertPointId = old.find(
        (p) =>
          p.prevPageId === newPrevPageId && p.parentId === newParentId && p.id !== draggedActiveId,
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
  useRegisterReorder(sectionId, reorderHandler)

  // Cross-collection move INTO this section at the dropped position. Registered
  // with the shared DndContext, which delegates here when a page from ANOTHER
  // section is dropped onto this (move-target) section. Mirrors reorderHandler's
  // position math, but also flips the page's collectionId and resolves `target`
  // from this section's `location`.
  function moveIntoHandler(active: Active, over: Over) {
    // Only the primary Команда/Личное sections register this, so they always
    // have a concrete collectionId + location.
    if (!location || collectionId == null) return
    const targetCollectionId = collectionId // narrowed to string
    const draggedActiveId = active.id as string
    const draggedPage = allPages.find((p) => p.id === draggedActiveId)
    if (!draggedPage) return

    // Resolve the drop position within THIS section's flat list.
    const toIdx = flatItems.findIndex((i) => i.id === over.id)
    const overItem = toIdx >= 0 ? flatItems[toIdx] : undefined

    // Default = head of this collection (drop on the bare body / header zone).
    let newParentId: string | null = null
    let newPrevPageId: string | null = null
    if (overItem) {
      newParentId = overItem.parentId
      // Cross-collection drops insert AFTER the hovered row: the page is new to
      // this list, so there's no fromIdx ordering to compare against.
      newPrevPageId = overItem.id
    }

    // Optimistic: move the page into this collection at the computed position
    // and repair the two affected back-pointers (the page's old next sibling +
    // the page that previously sat at the insert point).
    utils.page.listByWorkspace.setData({ workspaceId }, (old) => {
      if (!old) return old
      const oldNextId = old.find((p) => p.prevPageId === draggedActiveId)?.id
      const insertPointId = old.find(
        (p) =>
          p.prevPageId === newPrevPageId &&
          p.parentId === newParentId &&
          p.collectionId === targetCollectionId &&
          p.id !== draggedActiveId,
      )?.id
      return old.map((p) => {
        if (p.id === draggedActiveId)
          return {
            ...p,
            collectionId: targetCollectionId,
            parentId: newParentId,
            prevPageId: newPrevPageId,
          }
        if (oldNextId && p.id === oldNextId) return { ...p, prevPageId: draggedPage.prevPageId }
        if (insertPointId && p.id === insertPointId) return { ...p, prevPageId: draggedActiveId }
        return p
      })
    })

    moveInto.mutate({
      pageId: draggedActiveId,
      workspaceId,
      target: location, // 'team' | 'private'
      newParentId,
      newPrevPageId,
    })
  }
  useRegisterMoveInto(sectionId, moveIntoHandler)

  const activeIdx = activeId ? flatItems.findIndex((i) => i.id === activeId) : -1
  const overIdx = overId ? flatItems.findIndex((i) => i.id === overId) : -1

  // Only the primary Команда/Личное headers accept a cross-collection move drop;
  // extra ("pinned") collections have no `location` and so no move zone.
  const moveZoneId =
    location === 'team' ? SIDEBAR_ZONES.team : location === 'private' ? SIDEBAR_ZONES.private : null
  const moveTarget: 'team' | 'private' | null = location ?? null

  const header = (isOver: boolean) => (
    <Box
      onClick={() => setSectionOpen((prev) => !prev)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flex: 1,
        minWidth: 0,
        borderRadius: 0.75,
        cursor: 'pointer',
        color: 'text.secondary',
        outline: isOver ? '2px dashed' : 'none',
        outlineColor: 'primary.main',
        bgcolor: isOver ? 'action.hover' : 'transparent',
        '&:hover': { color: 'text.primary' },
      }}
    >
      {headerIcon ? (
        <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
          {headerIcon}
        </Box>
      ) : null}
      <Typography
        variant="overline"
        sx={{
          color: 'inherit',
          flex: 1,
          minWidth: 0,
          letterSpacing: '0.06em',
          lineHeight: 1.4,
        }}
        noWrap
      >
        {title ?? 'Страницы'}
      </Typography>
      {sectionOpen ? (
        <ArrowDropUpIcon sx={{ fontSize: 16 }} />
      ) : (
        <ArrowDropDownIcon sx={{ fontSize: 16 }} />
      )}
    </Box>
  )

  // The whole section (header + tree body) is the move droppable for the
  // primary Команда/Личное collections, so dropping a page ANYWHERE in the
  // section moves it there — not just on the thin header row. `isOver` is the
  // section-level hover; the per-row SortableContext still owns same-tree
  // reorder (the shared onDragEnd gives same-section reorder precedence).
  const sectionContent = (isOver: boolean, setNodeRef?: (el: HTMLElement | null) => void) => (
    <Box
      ref={setNodeRef}
      // Stable hook so a drop test can scope page rows to one section's subtree
      // ('team' / 'private' for the primary collections, else the collection id) —
      // sections share generated MUI class names, so there is no other reliable
      // selector.
      data-page-section={location ?? sectionId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        borderRadius: 0.75,
        outline: isOver ? '2px dashed' : 'none',
        outlineColor: 'primary.main',
        bgcolor: isOver ? 'action.hover' : 'transparent',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: 1,
        }}
      >
        {header(isOver)}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            aria-label="Новая страница"
            size="small"
            onClick={() => createFlow.openFor(null, location ? { location } : undefined)}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        <CreatePageDialog
          open={createFlow.open}
          onClose={createFlow.close}
          workspaceId={workspaceId}
          onCreatePage={createFlow.handleCreatePage}
          onCreateFromTemplate={createFlow.handleCreateFromTemplate}
          onCreateDashboard={createFlow.handleCreateDashboard}
          onUploadMeeting={createFlow.openMeetingUpload}
          meetingsEnabled={createFlow.meetingsEnabled}
          isCreating={createFlow.isCreating}
        />
        <MeetingUploadDialog
          open={createFlow.meetingOpen}
          onClose={createFlow.closeMeetingUpload}
          workspaceId={workspaceId}
        />
      </Box>

      {sectionOpen ? (
        // min-height keeps an empty/short section a usable move drop target.
        <Box sx={{ minHeight: 8 }}>
          {mounted ? (
            <SortableContext
              items={flatItems.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              {flatItems.map((item, idx) => (
                <SortablePageRow
                  key={item.id}
                  section={sectionId}
                  moveTarget={moveTarget}
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
          ) : (
            flatItems.map((item) => (
              <PageRowVisual
                key={item.id}
                item={item}
                workspaceId={workspaceId}
                pages={pages}
                favoritePageIds={favoritePageIds}
                showDropBefore={false}
                showDropAfter={false}
                onToggleCollapse={toggleCollapse}
              />
            ))
          )}
        </Box>
      ) : null}
    </Box>
  )

  if (moveZoneId) {
    return (
      <SidebarDropZone
        zoneId={moveZoneId}
        data={{ kind: 'section', section: sectionId, moveTarget }}
      >
        {({ isOver, setNodeRef }) => sectionContent(isOver, setNodeRef)}
      </SidebarDropZone>
    )
  }
  return sectionContent(false)
}
