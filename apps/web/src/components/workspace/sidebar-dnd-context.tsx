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
  title: string | null
  icon: string | null
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
    const target = over.id as string

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

    // Not a zone → an in-list reorder. Delegate to the list the dragged row
    // came from (it owns the optimistic update + the reorder mutation).
    const handler = handlers.current.get(data.section)
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
 */
export function SidebarDropZone({
  zoneId,
  children,
}: Readonly<{
  zoneId: SidebarZoneId
  children: (state: { isOver: boolean; setNodeRef: (el: HTMLElement | null) => void }) => ReactNode
}>) {
  const { isOver, setNodeRef } = useDroppable({ id: zoneId })
  return <>{children({ isOver, setNodeRef })}</>
}
