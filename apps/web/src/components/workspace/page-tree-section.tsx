'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AddIcon,
  Box,
  ChevronRightIcon,
  DashboardIcon,
  IconButton,
  MicIcon,
  MoreHorizIcon,
  Tooltip,
  Typography,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'
import { CreatePageDialog, useCreatePageFlow } from '@/components/templates'
import { MeetingUploadDialog } from '@/components/meeting/MeetingUploadDialog'
import { usePlanFeatures } from '@/components/workspace/plan-features-context'
import { PageIcon } from '@/components/page/page-icon'
import { PageContextMenu } from './page-context-menu'
import { MovePageDialog } from './move-page-dialog'
import { type FlatPageItem, type PageItem, flattenTree } from './types'

type Props = {
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
  collectionId?: string | null
  title?: string
  /** Collection kind this section represents, so the root "+" creates in the right place. */
  location?: 'team' | 'private'
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
        isCreating={createFlow.isCreating}
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

function SortablePageRow(props: RowVisualProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
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
}: Props) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const router = useRouter()
  const utils = trpc.useUtils()
  const createFlow = useCreatePageFlow(workspaceId)
  // The «Новый дашборд» launch: create the DASHBOARD page + its Dashboard row,
  // then navigate to it. No plan gate — the create mutation only requires a
  // writable workspace (the meeting upload is the plan-gated one).
  const createDashboard = trpc.dashboard.create.useMutation({
    onSuccess: async (result) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/pages/${result.pageId}`)
    },
  })
  // The «Загрузить встречу» launch action is gated on the plan flag: hidden when
  // the workspace's tier lacks meeting transcription (the create mutation also
  // 403s server-side, this just keeps the entry out of sight).
  const { meetingsEnabled } = usePlanFeatures()

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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
          {title ?? 'Страницы'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {meetingsEnabled ? (
            <Tooltip title="Загрузить встречу">
              <IconButton
                aria-label="Загрузить встречу"
                size="small"
                data-testid="upload-meeting-button"
                onClick={() => setMeetingOpen(true)}
              >
                <MicIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          ) : null}
          <Tooltip title="Новый дашборд">
            <IconButton
              aria-label="Новый дашборд"
              size="small"
              data-testid="new-dashboard-button"
              disabled={createDashboard.isPending}
              onClick={() => createDashboard.mutate({ workspaceId })}
            >
              <DashboardIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
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
          isCreating={createFlow.isCreating}
        />
        {meetingsEnabled ? (
          <MeetingUploadDialog
            open={meetingOpen}
            onClose={() => setMeetingOpen(false)}
            workspaceId={workspaceId}
          />
        ) : null}
      </Box>

      <Box>
        {mounted ? (
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
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  {activeItem.icon ? <PageIcon icon={activeItem.icon} size={16} /> : null}
                  <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                    {activeItem.title ?? 'Новая страница'}
                  </Typography>
                </Box>
              ) : null}
            </DragOverlay>
          </DndContext>
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
    </Box>
  )
}
