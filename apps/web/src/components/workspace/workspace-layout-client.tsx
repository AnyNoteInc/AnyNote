'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Box, StorefrontIcon } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { MarketplaceToolbarSearch } from '@/components/marketplace/marketplace-toolbar-search'
import { TemplateActionsToolbar } from '@/components/templates/template-actions-toolbar'
import { PageActionsToolbar } from '@/components/page/page-actions-toolbar'
import { PageEditorProvider } from '@/components/page/editor-context'
import { PageCommentsProvider } from '@/components/page/comments/comments-context'
import { CommentsSidebar } from '@/components/page/comments/comments-sidebar'
import { PageHistoryProvider } from '@/components/page/history/history-context'
import { HistorySidebar } from '@/components/page/history/history-sidebar'
import { PageChatProvider } from '@/components/page/page-chat/page-chat-context'
import { PageChatFab } from '@/components/page/page-chat/page-chat-fab'
import { PageChatSidebar } from '@/components/page/page-chat/page-chat-sidebar'
import { ChatActionsToolbar } from '@/components/workspace/chat/chat-actions-toolbar'
import { useFullWidth } from '@/hooks/use-full-width'

import type { RoleType } from '@repo/db'
import type { PlanFeatures } from '@repo/trpc'

import { SearchDialogProvider } from '../search/search-dialog-provider'
import { useSearchHotkey } from '../search/use-search-hotkey'
import { DomainJoinBanner } from './domain-join-banner'
import { SettingsDialogProvider } from './settings/settings-dialog-provider'
import { WorkspaceShell } from './workspace-shell'
import type { SidebarMode } from './workspace-shell'
import { WorkspaceSidebar } from './workspace-sidebar'
import { WorkspaceToolbar } from './workspace-toolbar'
import { WorkspaceUserMenu } from './workspace-user-menu'
import type { PageItem } from './types'

export type WorkspaceAccessKind = 'member' | 'guest'

type Props = Readonly<{
  workspace: { id: string; name: string; icon: string | null }
  /** 'guest' = page-grant holder without a member row (people spec §3/§5). */
  accessKind: WorkspaceAccessKind
  /** Member role resolved server-side (null for guests); gates the history UI. */
  role: RoleType | null
  features: PlanFeatures
  pages: PageItem[]
  user: { id: string; firstName: string; lastName: string; email: string; image: string | null }
  children: ReactNode
}>

const STORAGE_KEY = 'workspace.sidebar.mode'
const WIDTH_STORAGE_KEY = 'workspace.sidebar.width'
const DEFAULT_MODE: SidebarMode = 'full'
export const SIDEBAR_WIDTH = 313
export const SIDEBAR_MIN_WIDTH = 220
export const SIDEBAR_MAX_WIDTH = 480
export type WorkspaceSidebarSection = 'chats' | 'pages'

const clampSidebarWidth = (value: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value))

function sidebarSectionFromPathname(pathname: string): WorkspaceSidebarSection | null {
  if (pathname.includes('/chats')) return 'chats'
  if (pathname.includes('/pages') || pathname.includes('/trash')) return 'pages'
  return null
}

export function WorkspaceLayoutClient({
  workspace,
  accessKind,
  role,
  features,
  pages: initialPages,
  user,
  children,
}: Props) {
  const isGuest = accessKind === 'guest'
  // Read pages via useQuery with RSC-provided initialData so that rename /
  // delete / move mutations can invalidate the cache and re-render the
  // breadcrumb without a full server refresh. Member-gated — guests get their
  // pages from people.myGrantedPages inside the sidebar instead.
  const pagesQuery = trpc.page.listByWorkspace.useQuery(
    { workspaceId: workspace.id },
    { staleTime: 0, enabled: !isGuest },
  )
  const pages: PageItem[] = pagesQuery.data ?? initialPages
  const [mode, setMode] = useState<SidebarMode>(DEFAULT_MODE)
  const pathname = usePathname()
  const lastSidebarPathnameRef = useRef(pathname)
  const [sidebarSection, setSidebarSection] = useState<WorkspaceSidebarSection>(() => {
    if (isGuest) return 'pages'
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

  // Draggable sidebar width (spec item 4): default → hydrate from
  // localStorage after mount (the sidebar.mode pattern), persist on drag end.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH)
  useEffect(() => {
    const stored = Number.parseInt(window.localStorage.getItem(WIDTH_STORAGE_KEY) ?? '', 10)
    if (!Number.isNaN(stored)) setSidebarWidth(clampSidebarWidth(stored))
  }, [])
  const commitSidebarWidth = (width: number) => {
    setSidebarWidth(width)
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
  }

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

  // Template view (/marketplace/templates/{id}): the toolbar shows the template
  // title in the breadcrumb and the "Использовать" + actions menu in the right
  // slot, so the template view itself needs no second header row.
  const templateIdMatch = pathname.match(/\/marketplace\/templates\/([a-f0-9-]{36})/)
  const activeTemplateId = templateIdMatch?.[1] ?? null
  const activeTemplate = trpc.template.getById.useQuery(
    { templateId: activeTemplateId ?? '', workspaceId: workspace.id },
    { enabled: activeTemplateId !== null },
  )

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
        return [
          base,
          { label: 'Шаблоны', href: '/marketplace' },
          { label: activeTemplate.data?.title ?? 'Шаблон' },
        ]
      }
      return [base]
    }
    return [{ label: workspace.name }]
  }, [pathname, activeChat, pages, workspace.name, activeTemplate.data?.title])

  useEffect(() => {
    const title = breadcrumbs.map((b) => b.label).join(' / ')
    document.title = title ? `${title} — AnyNote` : 'AnyNote'
  }, [breadcrumbs])

  const userMenu = (
    <WorkspaceUserMenu
      user={user}
      features={features}
      workspace={{ name: workspace.name, icon: workspace.icon }}
    />
  )

  const sidebarProps = {
    workspace,
    accessKind,
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

  // Document history is edit-gated server-side; surface the toggle only to
  // workspace editors (OWNER/ADMIN/EDITOR). The role is resolved server-side and
  // prop-drilled from the (active) layout, so no client round-trip is needed.
  // The history tRPC calls re-check the page-level edit access on every request,
  // so this is purely the UI gate.
  const historyEnabled = role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR'

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
            ) : activeTemplateId && activeTemplate.data ? (
              <TemplateActionsToolbar
                templateId={activeTemplateId}
                workspaceId={workspace.id}
                canEdit={activeTemplate.data.canEdit}
                title={activeTemplate.data.title}
                icon={activeTemplate.data.icon}
                description={activeTemplate.data.description}
              />
            ) : pathname.startsWith('/marketplace') &&
              !pathname.startsWith('/marketplace/templates/') ? (
              <MarketplaceToolbarSearch />
            ) : null
          }
        />
        {/* Persistent domain-join prompt (identity spec §6): shows under the
            toolbar on every (active) route while the user's e-mail domain
            unlocks joinable workspaces — incl. SSO-JIT users with no
            membership yet. */}
        <DomainJoinBanner />
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
      {activePageId ? <HistorySidebar /> : null}
      {activePageId ? <PageChatSidebar workspaceId={workspace.id} pageId={activePageId} /> : null}
      {activePageId ? <PageChatFab /> : null}
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
      <PageHistoryProvider
        pageId={activePageId ?? ''}
        workspaceId={workspace.id}
        enabled={historyEnabled}
      >
        <PageChatProvider pageId={activePageId ?? ''} pageType={activePageType}>
          <PageEditorProvider>{mainContent}</PageEditorProvider>
        </PageChatProvider>
      </PageHistoryProvider>
    </PageCommentsProvider>
  )

  return (
    <SearchDialogProvider workspaceId={workspace.id}>
      <SettingsDialogProvider workspaceId={workspace.id} currentUserId={user.id}>
        {/* Search is member-gated server-side — don't register the hotkey for guests. */}
        {isGuest ? null : (
          <WorkspaceHotkeyMount
            workspaceId={workspace.id}
            onPages={() => setSidebarSection('pages')}
          />
        )}
        <WorkspaceShell
          mode={mode}
          sidebar={sidebar}
          sidebarWidth={sidebarWidth}
          onSidebarWidthCommit={commitSidebarWidth}
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
