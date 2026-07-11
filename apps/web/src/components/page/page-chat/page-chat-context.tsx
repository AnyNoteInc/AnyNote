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
export const PAGE_CHAT_SIDEBAR_MIN_WIDTH = 320
export const PAGE_CHAT_SIDEBAR_MAX_WIDTH = 640

/** Notion-style display modes: docked right column vs floating window. */
export type PageChatDisplayMode = 'docked' | 'floating'

const DISPLAY_MODE_KEY = 'pageChat.displayMode'
const SIDEBAR_WIDTH_KEY = 'pageChat.sidebar.width'

const clampSidebarWidth = (value: number) =>
  Math.min(PAGE_CHAT_SIDEBAR_MAX_WIDTH, Math.max(PAGE_CHAT_SIDEBAR_MIN_WIDTH, value))

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
  /** Docked-panel width (spec item 4) — draggable, persisted per browser. */
  sidebarWidth: number
  /** Live width during a drag; does not persist. */
  setSidebarWidth: (width: number) => void
  /** Final width on drag end; persists to localStorage. */
  commitSidebarWidth: (width: number) => void
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

  // Draggable docked-panel width — same hydrate-after-mount pattern.
  const [sidebarWidth, setSidebarWidthState] = useState(PAGE_CHAT_SIDEBAR_WIDTH)
  useEffect(() => {
    const stored = Number.parseInt(window.localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '', 10)
    if (!Number.isNaN(stored)) setSidebarWidthState(clampSidebarWidth(stored))
  }, [])
  const setSidebarWidth = useCallback((width: number) => {
    setSidebarWidthState(clampSidebarWidth(width))
  }, [])
  const commitSidebarWidth = useCallback((width: number) => {
    const clamped = clampSidebarWidth(width)
    setSidebarWidthState(clamped)
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped))
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
      sidebarWidth,
      setSidebarWidth,
      commitSidebarWidth,
    }),
    [
      enabled,
      panelOpen,
      togglePanel,
      closePanel,
      activeChatId,
      storedDisplayMode,
      setDisplayMode,
      sidebarWidth,
      setSidebarWidth,
      commitSidebarWidth,
    ],
  )

  return <PageChatContext.Provider value={value}>{children}</PageChatContext.Provider>
}
