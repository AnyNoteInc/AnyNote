'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { usePagePanelMember } from '@/components/page/panel-region-context'

export type PageHistoryContextValue = {
  /** History is only available to editors (the tRPC queries are edit-gated). */
  enabled: boolean
  pageId: string
  workspaceId: string
  panelOpen: boolean
  togglePanel: () => void
  closePanel: () => void
}

const PageHistoryContext = createContext<PageHistoryContextValue | null>(null)

export function usePageHistoryContext(): PageHistoryContextValue {
  const ctx = useContext(PageHistoryContext)
  if (!ctx) throw new Error('usePageHistoryContext must be used within PageHistoryProvider')
  return ctx
}

/** Non-throwing: PageRenderer монтируется и без провайдера истории
 *  (share view, database item modal) — там оффсет панели просто 0. */
export function usePageHistoryContextOptional(): PageHistoryContextValue | null {
  return useContext(PageHistoryContext)
}

export function PageHistoryProvider({
  pageId,
  workspaceId,
  enabled,
  children,
}: {
  pageId: string
  workspaceId: string
  enabled: boolean
  children: ReactNode
}) {
  const [panelOpen, setPanelOpen] = useState(false)

  // Close the panel whenever the active page changes so a stale revision list
  // never bleeds across pages (the provider is not remounted per page).
  const [prevPageId, setPrevPageId] = useState(pageId)
  if (pageId !== prevPageId) {
    setPrevPageId(pageId)
    setPanelOpen(false)
  }

  const closePanel = useCallback(() => setPanelOpen(false), [])
  const togglePanel = useCallback(() => setPanelOpen((v) => !v), [])

  // Единый регион панелей: открытая история вытесняет комментарии/просмотр.
  usePagePanelMember('history', panelOpen, closePanel)

  const value = useMemo<PageHistoryContextValue>(
    () => ({ enabled, pageId, workspaceId, panelOpen, togglePanel, closePanel }),
    [enabled, pageId, workspaceId, panelOpen, togglePanel, closePanel],
  )

  return <PageHistoryContext.Provider value={value}>{children}</PageHistoryContext.Provider>
}
