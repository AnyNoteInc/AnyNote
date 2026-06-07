'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Box, StorefrontIcon } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { MarketplaceToolbarSearch } from '@/components/marketplace/marketplace-toolbar-search'
import { PageActionsToolbar } from '@/components/page/page-actions-toolbar'
import { PageEditorProvider } from '@/components/page/editor-context'
import { PageCommentsProvider } from '@/components/page/comments/comments-context'
import { CommentsSidebar } from '@/components/page/comments/comments-sidebar'
import { ChatActionsToolbar } from '@/components/workspace/chat/chat-actions-toolbar'
import { useFullWidth } from '@/hooks/use-full-width'

import type { PlanFeatures } from '@repo/trpc'

import { SearchDialogProvider } from '../search/search-dialog-provider'
import { useSearchHotkey } from '../search/use-search-hotkey'
import { SettingsDialogProvider } from './settings/settings-dialog-provider'
import { WorkspaceShell } from './workspace-shell'
import type { SidebarMode } from './workspace-shell'
import { WorkspaceSidebar } from './workspace-sidebar'
import { WorkspaceToolbar } from './workspace-toolbar'
import { WorkspaceUserMenu } from './workspace-user-menu'
import type { PageItem } from './types'

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  features: PlanFeatures
  pages: PageItem[]
  user: { id: string; firstName: string; lastName: string; email: string; image: string | null }
  children: ReactNode
}

const STORAGE_KEY = 'workspace.sidebar.mode'
const DEFAULT_MODE: SidebarMode = 'full'
export const SIDEBAR_WIDTH = 313
export type WorkspaceSidebarSection = 'chats' | 'pages'

function sidebarSectionFromPathname(pathname: string): WorkspaceSidebarSection | null {
  if (pathname.includes('/chats')) return 'chats'
  if (pathname.includes('/pages') || pathname.includes('/trash')) return 'pages'
  return null
}

export function WorkspaceLayoutClient({
  workspace,
  features,
  pages: initialPages,
  user,
  children,
}: Props) {
  // Read pages via useQuery with RSC-provided initialData so that rename /
  // delete / move mutations can invalidate the cache and re-render the
  // breadcrumb without a full server refresh.
  const pagesQuery = trpc.page.listByWorkspace.useQuery(
    { workspaceId: workspace.id },
    { staleTime: 0 },
  )
  const pages: PageItem[] = pagesQuery.data ?? initialPages
  const [mode, setMode] = useState<SidebarMode>(DEFAULT_MODE)
  const pathname = usePathname()
  const lastSidebarPathnameRef = useRef(pathname)
  const [sidebarSection, setSidebarSection] = useState<WorkspaceSidebarSection>(() => {
    const fromPath = sidebarSectionFromPathname(pathname)
    if (fromPath) return fromPath
    return features.chatsEnabled ? 'chats' : 'pages'
  })

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'full' || stored === 'hidden') setMode(stored)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  useEffect(() => {
    if (lastSidebarPathnameRef.current === pathname) return
    lastSidebarPathnameRef.current = pathname
    const nextSection = sidebarSectionFromPathname(pathname)
    if (nextSection) setSidebarSection(nextSection)
  }, [pathname])

  useEffect(() => {
    if (!features.chatsEnabled && sidebarSection === 'chats') {
      setSidebarSection('pages')
    }
  }, [features.chatsEnabled, sidebarSection])

  const chatIdMatch = pathname.match(/\/chats\/([a-f0-9-]{36})$/)
  const activeChatId = chatIdMatch?.[1] ?? null

  const chats = trpc.chat.listChats.useQuery(
    { workspaceId: workspace.id },
    { enabled: activeChatId !== null },
  )
  const activeChat = activeChatId ? (chats.data?.find((c) => c.id === activeChatId) ?? null) : null

  const breadcrumbs = useMemo(() => {
    if (pathname.includes('/chats')) {
      const base = { label: 'Чаты', href: '/chats/new' }
      if (activeChat) return [base, { label: activeChat.title ?? 'Без названия' }]
      return [base]
    }
    if (pathname.includes('/trash')) {
      return [{ label: 'Корзина' }]
    }
    const pageIdMatch = pathname.match(/\/pages\/([a-f0-9-]{36})/)
    if (pageIdMatch) {
      const base = { label: 'Страницы' }
      const pagesById = new Map(pages.map((p) => [p.id, p]))
      const chain: PageItem[] = []
      let current = pagesById.get(pageIdMatch[1] ?? '')
      while (current) {
        chain.unshift(current)
        current = current.parentId ? pagesById.get(current.parentId) : undefined
      }
      if (chain.length === 0) return [base]
      return [
        base,
        ...chain.map((p, idx) => ({
          label: p.title ?? 'Новая страница',
          // Link ancestors back to themselves; the current page (last crumb)
          // stays plain text so users don't click a no-op link.
          href: idx === chain.length - 1 ? undefined : `/pages/${p.id}`,
        })),
      ]
    }
    if (pathname.startsWith('/marketplace')) {
      const base = {
        label: 'Маркетплейс',
        href: '/marketplace',
        icon: <StorefrontIcon sx={{ fontSize: 18 }} />,
      }
      if (pathname.startsWith('/marketplace/templates/')) {
        return [base, { label: 'Шаблон' }]
      }
      return [base]
    }
    return [{ label: workspace.name }]
  }, [pathname, activeChat, pages, workspace.name])

  useEffect(() => {
    const title = breadcrumbs.map((b) => b.label).join(' / ')
    document.title = title ? `${title} — AnyNote` : 'AnyNote'
  }, [breadcrumbs])

  const userMenu = <WorkspaceUserMenu user={user} features={features} />

  const sidebarProps = {
    workspace,
    features,
    pages,
    userMenu,
    activeSection: sidebarSection,
    onSectionChange: setSidebarSection,
  }

  const pageIdMatch = pathname.match(/\/pages\/([a-f0-9-]{36})/)
  const activePageId = pageIdMatch?.[1] ?? null

  // Reuse the already-loaded workspace page list rather than refetching the
  // active page (getById ships the full contentYjs blob) just to read its type.
  const activePageType = activePageId ? pages.find((p) => p.id === activePageId)?.type : undefined

  const [fullWidth] = useFullWidth(activePageId ?? '')

  // PageEditorProvider wraps BOTH the toolbar (so PageActionsMenu → PageExportDialog
  // can read the editor via usePageEditor) and the editor content (so PageRenderer
  // can register the editor via setEditor).
  const mainContent = (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      {/* Toolbar + content live in a column; the comments sidebar is a sibling
          full-height column on the right (starts at the top, beside the toolbar). */}
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <WorkspaceToolbar
          breadcrumbs={breadcrumbs}
          sidebarHidden={mode === 'hidden'}
          onOpenSidebar={() => setMode('full')}
          sidebarContent={<WorkspaceSidebar {...sidebarProps} />}
          rightSlot={
            activeChatId ? (
              <ChatActionsToolbar chatId={activeChatId} workspaceId={workspace.id} />
            ) : activePageId ? (
              <PageActionsToolbar pageId={activePageId} workspaceId={workspace.id} />
            ) : pathname.startsWith('/marketplace') &&
              !pathname.startsWith('/marketplace/templates/') ? (
              <MarketplaceToolbarSearch />
            ) : null
          }
        />
        <Box
          component="main"
          sx={{
            bgcolor: 'background.paper',
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflowX: 'hidden',
            overflowY: 'auto',
          }}
          data-full-width={fullWidth ? 'true' : 'false'}
          className="page-content-scroll"
        >
          {children}
        </Box>
      </Box>
      {activePageId ? <CommentsSidebar /> : null}
    </Box>
  )

  const sidebar =
    mode === 'full' ? <WorkspaceSidebar {...sidebarProps} onHide={() => setMode('hidden')} /> : null

  const pageMain = (
    <PageCommentsProvider
      target={{ pageId: activePageId ?? '' }}
      pageType={activePageType}
      canComment
      canDeleteComments
      workspaceId={workspace.id}
    >
      <PageEditorProvider>{mainContent}</PageEditorProvider>
    </PageCommentsProvider>
  )

  return (
    <SearchDialogProvider workspaceId={workspace.id}>
      <SettingsDialogProvider workspaceId={workspace.id} currentUserId={user.id}>
        <WorkspaceHotkeyMount
          workspaceId={workspace.id}
          onPages={() => setSidebarSection('pages')}
        />
        <WorkspaceShell
          mode={mode}
          sidebar={sidebar}
          main={activePageId ? pageMain : mainContent}
        />
      </SettingsDialogProvider>
    </SearchDialogProvider>
  )
}

function WorkspaceHotkeyMount({
  workspaceId,
  onPages,
}: {
  workspaceId: string
  onPages: () => void
}) {
  useSearchHotkey(workspaceId, { onPages })
  return null
}
