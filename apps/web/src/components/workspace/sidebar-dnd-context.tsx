'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core'
import { Box, Typography } from '@repo/ui/components'
import { trpc } from '@/trpc/client'
import { PageIcon } from '@/components/page/page-icon'

/**
 * Stable ids for the cross-section drop targets. Reorder-within-a-list keeps the
 * page id as its draggable id, so anything starting with `zone:` is a section
 * drop, never a reorder.
 */
export const SIDEBAR_ZONES = {
  favorites: 'zone:favorites',
  team: 'zone:team',
  private: 'zone:private',
  archive: 'zone:archive',
  trash: 'zone:trash',
} as const

export type SidebarZoneId = (typeof SIDEBAR_ZONES)[keyof typeof SIDEBAR_ZONES]

function isZoneId(id: string): id is SidebarZoneId {
  return id.startsWith('zone:')
}

/** Where a cross-collection move drop lands. `null` = the section is not a move target. */
export type MoveTarget = 'team' | 'private' | null

/** Data each draggable page row carries so the shared context can route it. */
export type SidebarDragData = {
  kind: 'page'
  /**
   * The real Page id. Draggable ids may be namespaced (e.g. favorites use
   * `fav:{pageId}`) so the SAME page can be draggable in two lists at once
   * without an id collision under the single DndContext — but every mutation
   * needs the bare page id, which lives here.
   */
  pageId: string
  /** Which list the row lives in, so a non-zone drop delegates to that list's reorder. */
  section: string
  /**
   * The collection a CROSS-section drop ONTO this row's section moves to. Rows
   * are droppables too (via useSortable), so when a page from another section
   * lands on a row, `over.data` resolves the target section's move target here.
   */
  moveTarget: MoveTarget
  title: string | null
  icon: string | null
}

/**
 * Data the section-level droppable area carries so the shared `onDragEnd` can
 * resolve which SECTION a drop landed in — and whether that section is a
 * cross-collection move target — when the drop lands on the body background
 * (or between rows) rather than on a specific row.
 */
export type SidebarSectionDropData = {
  kind: 'section'
  /** The section the drop landed in (matches a draggable row's `section`). */
  section: string
  /** The collection a cross-section drop into this area moves the page to. */
  moveTarget: MoveTarget
}

/**
 * Resolve the SECTION (and its move target) a drop landed in from the
 * droppable's `data`. Works for both a page row (`kind: 'page'`) and a
 * section-level area (`kind: 'section'`); returns null for zones / unknown.
 */
function resolveDropSection(
  data: unknown,
): { section: string; moveTarget: MoveTarget } | null {
  if (!data || typeof data !== 'object') return null
  const kind = (data as { kind?: unknown }).kind
  if (kind !== 'page' && kind !== 'section') return null
  const d = data as { section?: unknown; moveTarget?: unknown }
  if (typeof d.section !== 'string') return null
  const moveTarget =
    d.moveTarget === 'team' || d.moveTarget === 'private' ? d.moveTarget : null
  return { section: d.section, moveTarget }
}

type ReorderHandler = (active: Active, over: Over) => void

type SidebarDndContextValue = {
  activeId: string | null
  overId: string | null
}

const SidebarDndCtx = createContext<SidebarDndContextValue>({ activeId: null, overId: null })

export function useSidebarDnd(): SidebarDndContextValue {
  return useContext(SidebarDndCtx)
}

const ReorderRegistryCtx = createContext<{
  register: (section: string, handler: ReorderHandler) => () => void
} | null>(null)

/**
 * Each list (favorites / a collection tree) registers its own reorder handler
 * keyed by its section id. The shared `onDragEnd` looks the handler up by the
 * dragged row's `section` and delegates non-zone drops to it, so per-list
 * ordering keeps working under the single hoisted DndContext.
 */
export function useRegisterReorder(section: string, handler: ReorderHandler): void {
  const registry = useContext(ReorderRegistryCtx)
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  // Register a stable shim once per section; the ref keeps the latest closure
  // so the registered handler never goes stale without re-registering.
  const stable = useCallback<ReorderHandler>((active, over) => handlerRef.current(active, over), [])
  useEffect(() => {
    if (!registry) return
    return registry.register(section, stable)
  }, [registry, section, stable])
}

type Props = Readonly<{
  workspaceId: string
  children: ReactNode
}>

export function SidebarDndProvider({ workspaceId, children }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeData, setActiveData] = useState<SidebarDragData | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const handlers = useRef(new Map<string, ReorderHandler>())
  const register = useCallback((section: string, handler: ReorderHandler) => {
    handlers.current.set(section, handler)
    return () => {
      if (handlers.current.get(section) === handler) handlers.current.delete(section)
    }
  }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const utils = trpc.useUtils()

  // Cross-section mutations mirror use-page-actions exactly (same inputs + the
  // same cache invalidation), so a drop and the context-menu action converge.
  const invalidateCollections = () => {
    void utils.page.listByWorkspace.invalidate({ workspaceId })
    void utils.page.listArchived.invalidate({ workspaceId })
    void utils.page.listShared.invalidate({ workspaceId })
    void utils.collection.list.invalidate({ workspaceId })
  }
  const invalidateAll = () => {
    void utils.page.listByWorkspace.invalidate({ workspaceId })
    void utils.page.listFavorites.invalidate({ workspaceId })
    void utils.page.listTrashed.invalidate({ workspaceId })
  }

  const addFavorite = trpc.page.addFavorite.useMutation({
    onSuccess: () => {
      void utils.page.listFavorites.invalidate({ workspaceId })
    },
  })
  const moveToCollection = trpc.page.moveToCollection.useMutation({
    onSuccess: invalidateCollections,
  })
  const archive = trpc.page.archive.useMutation({ onSuccess: invalidateCollections })
  const softDelete = trpc.page.softDelete.useMutation({ onSuccess: invalidateAll })

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(active.id as string)
    setActiveData((active.data.current as SidebarDragData | undefined) ?? null)
  }

  function onDragOver({ over }: DragOverEvent) {
    setOverId((over?.id as string | undefined) ?? null)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    setActiveData(null)
    setOverId(null)

    if (!over) return

    const data = active.data.current as SidebarDragData | undefined
    if (!data) return
    const pageId = data.pageId
    const sourceSection = data.section
    const target = over.id as string

    // Resolve which SECTION the drop landed in (from the droppable's data —
    // a page row OR a section-level area), independent of `over.id`.
    const dropSection = resolveDropSection(over.data.current)

    // (1) SAME-section reorder takes precedence over any zone hit. closestCenter
    // can pick a section header zone (e.g. zone:favorites) as the nearest
    // droppable when dragging the topmost row upward; if the drop actually
    // resolves to the dragged row's OWN section, reorder instead of swallowing
    // it as an idempotent zone mutation. Delegate to that list's reorder handler
    // (it owns the optimistic update + the reorder mutation).
    if (dropSection && dropSection.section === sourceSection) {
      const handler = handlers.current.get(sourceSection)
      handler?.(active, over)
      return
    }

    // (2) CROSS-section drop onto a section that is a move target (Команда /
    // Личное) → MOVE the page there, even when `over` is a page row in the
    // target tree (not the bare header zone). This makes the WHOLE section a
    // valid move target, not just the thin header.
    if (dropSection && dropSection.moveTarget && dropSection.section !== sourceSection) {
      moveToCollection.mutate({ pageId, workspaceId, target: dropSection.moveTarget })
      return
    }

    if (isZoneId(target)) {
      switch (target) {
        case SIDEBAR_ZONES.favorites:
          // Favorite is purely additive — the page keeps its collection.
          addFavorite.mutate({ pageId })
          return
        case SIDEBAR_ZONES.team:
          moveToCollection.mutate({ pageId, workspaceId, target: 'team' })
          return
        case SIDEBAR_ZONES.private:
          moveToCollection.mutate({ pageId, workspaceId, target: 'private' })
          return
        case SIDEBAR_ZONES.archive:
          archive.mutate({ id: pageId, workspaceId })
          return
        case SIDEBAR_ZONES.trash:
          softDelete.mutate({ id: pageId, workspaceId })
          return
        default:
          return
      }
    }

    // A drop that resolves to a different section that is NOT a move target
    // (e.g. an extra "pinned" collection, or favorites→favorites already
    // handled above) → fall back to delegating a reorder to the source list.
    // This keeps same-tree reorder working when `over` is a row in the source
    // tree but resolveDropSection couldn't read its data for some reason.
    const handler = handlers.current.get(sourceSection)
    handler?.(active, over)
  }

  const registry = useMemo(() => ({ register }), [register])
  const value = useMemo<SidebarDndContextValue>(() => ({ activeId, overId }), [activeId, overId])

  return (
    <ReorderRegistryCtx.Provider value={registry}>
      <SidebarDndCtx.Provider value={value}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          {children}
          <DragOverlay>
            {activeData ? (
              <Box
                sx={{
                  px: 1,
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
                {activeData.icon ? <PageIcon icon={activeData.icon} size={16} /> : null}
                <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                  {activeData.title ?? 'Новая страница'}
                </Typography>
              </Box>
            ) : null}
          </DragOverlay>
        </DndContext>
      </SidebarDndCtx.Provider>
    </ReorderRegistryCtx.Provider>
  )
}

/**
 * Marks a region as a cross-section drop target. Renders its children and
 * highlights (via the render-prop `isOver`) while a page hovers it.
 *
 * `data` lets a section-level area carry which SECTION (and move target) the
 * drop resolves to, so the shared `onDragEnd` routes a body/between-rows drop
 * to a move even when `over` is the area droppable rather than the header zone.
 */
export function SidebarDropZone({
  zoneId,
  data,
  children,
}: Readonly<{
  zoneId: SidebarZoneId
  data?: SidebarSectionDropData
  children: (state: { isOver: boolean; setNodeRef: (el: HTMLElement | null) => void }) => ReactNode
}>) {
  const { isOver, setNodeRef } = useDroppable({ id: zoneId, data })
  return <>{children({ isOver, setNodeRef })}</>
}
