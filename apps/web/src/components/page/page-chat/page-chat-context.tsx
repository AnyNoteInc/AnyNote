'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { PageType } from '@repo/db'

export const PAGE_CHAT_SIDEBAR_WIDTH = 400

/** Notion-style display modes: docked right column vs floating window. */
export type PageChatDisplayMode = 'docked' | 'floating'

const DISPLAY_MODE_KEY = 'pageChat.displayMode'

/** Default composer context chip (spec §7). Single source: the sidebar passes
 *  it (or the selection label) explicitly, and WorkspaceChatClient imports it
 *  as its fallback when no explicit label is given. */
export const PAGE_CHAT_CONTEXT_LABEL = 'Контекст: Текущая страница'

type PageChatContextValue = {
  enabled: boolean
  panelOpen: boolean
  togglePanel: () => void
  closePanel: () => void
  activeChatId: string | null
  setActiveChatId: (id: string | null) => void
  displayMode: PageChatDisplayMode
  setDisplayMode: (mode: PageChatDisplayMode) => void
}

const PageChatContext = createContext<PageChatContextValue | null>(null)

/** Non-throwing — the FAB/sidebar also render on surfaces without the provider
 *  (PageView, non-page routes) and must simply disappear there. Caveat: the FAB
 *  additionally reads usePageCommentsContext, which THROWS without
 *  PageCommentsProvider — so the FAB is only mountable where both providers
 *  exist (currently the workspace layout's pageMain). */
export function usePageChatContext(): PageChatContextValue | null {
  return useContext(PageChatContext)
}

export function PageChatProvider({
  pageId,
  pageType,
  children,
}: {
  pageId: string
  pageType: PageType | undefined
  children: ReactNode
}) {
  const enabled = pageType === 'TEXT'
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  // Display mode survives navigation and reloads (the workspace.sidebar.mode
  // pattern): default docked, hydrate from localStorage after mount.
  const [storedDisplayMode, setStoredDisplayMode] = useState<PageChatDisplayMode>('docked')
  useEffect(() => {
    const stored = window.localStorage.getItem(DISPLAY_MODE_KEY)
    if (stored === 'docked' || stored === 'floating') setStoredDisplayMode(stored)
  }, [])
  const setDisplayMode = useCallback((mode: PageChatDisplayMode) => {
    setStoredDisplayMode(mode)
    window.localStorage.setItem(DISPLAY_MODE_KEY, mode)
  }, [])

  // Reset transient chat UI when navigating to a different page WITHOUT
  // remounting the provider (the comments-context render-time pattern).
  const [prevPageId, setPrevPageId] = useState(pageId)
  if (pageId !== prevPageId) {
    setPrevPageId(pageId)
    setPanelOpen(false)
    setActiveChatId(null)
  }

  const togglePanel = useCallback(() => setPanelOpen((v) => !v), [])
  const closePanel = useCallback(() => setPanelOpen(false), [])

  const value = useMemo(
    () => ({
      enabled,
      panelOpen,
      togglePanel,
      closePanel,
      activeChatId,
      setActiveChatId,
      displayMode: storedDisplayMode,
      setDisplayMode,
    }),
    [enabled, panelOpen, togglePanel, closePanel, activeChatId, storedDisplayMode, setDisplayMode],
  )

  return <PageChatContext.Provider value={value}>{children}</PageChatContext.Provider>
}
