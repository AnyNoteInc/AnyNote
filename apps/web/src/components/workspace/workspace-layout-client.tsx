'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PageActionsToolbar } from '@/components/page/page-actions-toolbar'
import { PageEditorProvider } from '@/components/page/editor-context'
import { ChatActionsToolbar } from '@/components/workspace/chat/chat-actions-toolbar'
import { useFullWidth } from '@/hooks/use-full-width'
import { useOutlineMode } from '@/hooks/use-outline-mode'

import type { PlanFeatures } from '@repo/trpc'

import { SearchDialogProvider } from '../search/search-dialog-provider'
import { useSearchHotkey } from '../search/use-search-hotkey'
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
export type WorkspaceSidebarSection = 'chats' | 'pages' | 'settings'

function sidebarSectionFromPathname(pathname: string): WorkspaceSidebarSection | null {
  if (pathname.includes('/chats')) return 'chats'
  if (pathname.includes('/settings')) return 'settings'
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
  const [sidebarSection, setSidebarSection] = useState<WorkspaceSidebarSection>(
    () => sidebarSectionFromPathname(pathname) ?? 'chats',
  )

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

  const chatIdMatch = pathname.match(/\/chats\/([a-f0-9-]{36})$/)
  const activeChatId = chatIdMatch?.[1] ?? null

  const chats = trpc.chat.listChats.useQuery(
    { workspaceId: workspace.id },
    { enabled: activeChatId !== null },
  )
  const activeChat = activeChatId ? (chats.data?.find((c) => c.id === activeChatId) ?? null) : null

  const breadcrumbs = useMemo(() => {
    if (pathname.includes('/chats')) {
      const base = { label: 'Чаты', href: `/workspaces/${workspace.id}/chats` }
      if (activeChat) return [base, { label: activeChat.title ?? 'Без названия' }]
      return [base]
    }
    if (pathname.includes('/settings')) {
      return [{ label: 'Настройки' }]
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
          href: idx === chain.length - 1 ? undefined : `/workspaces/${workspace.id}/pages/${p.id}`,
        })),
      ]
    }
    return [{ label: workspace.name }]
  }, [pathname, activeChat, pages, workspace.id, workspace.name])

  useEffect(() => {
    const title = breadcrumbs.map((b) => b.label).join(' / ')
    document.title = title ? `${title} — AnyNote` : 'AnyNote'
  }, [breadcrumbs])

  const userMenu = <WorkspaceUserMenu user={user} features={features} />

  const sidebarProps = {
    workspace,
    pages,
    userMenu,
    activeSection: sidebarSection,
    onSectionChange: setSidebarSection,
  }

  const pageIdMatch = pathname.match(/\/pages\/([a-f0-9-]{36})/)
  const activePageId = pageIdMatch?.[1] ?? null

  const [fullWidth] = useFullWidth(activePageId ?? '')
  const [outlineMode] = useOutlineMode(activePageId ?? '')

  // PageEditorProvider wraps BOTH the toolbar (so PageActionsMenu → PageExportDialog
  // can read the editor via usePageEditor) and the editor content (so PageRenderer
  // can register the editor via setEditor).
  const mainContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
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
          ) : null
        }
      />
      <Box
        component="main"
        sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
        data-full-width={fullWidth ? 'true' : 'false'}
        data-outline-mode={activePageId ? outlineMode : undefined}
        className="page-content-scroll"
      >
        {children}
      </Box>
    </Box>
  )

  const sidebar =
    mode === 'full' ? <WorkspaceSidebar {...sidebarProps} onHide={() => setMode('hidden')} /> : null

  return (
    <SearchDialogProvider workspaceId={workspace.id}>
      <WorkspaceHotkeyMount workspaceId={workspace.id} onPages={() => setSidebarSection('pages')} />
      <WorkspaceShell
        mode={mode}
        sidebar={sidebar}
        main={activePageId ? <PageEditorProvider>{mainContent}</PageEditorProvider> : mainContent}
      />
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
