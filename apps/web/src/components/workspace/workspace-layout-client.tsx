'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PageActionsToolbar } from '@/components/page/page-actions-toolbar'
import { PageEditorProvider } from '@/components/page/editor-context'
import { useFullWidth } from '@/hooks/use-full-width'

import type { PlanFeatures } from '@repo/trpc'

import { WorkspaceShell } from './workspace-shell'
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

const STORAGE_KEY = 'workspace.sidebar.collapsed'
export const SIDEBAR_WIDTH = 313

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
  const [hidden, setHidden] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') setHidden(true)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(hidden))
  }, [hidden])

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

  const sidebarProps = { workspace, features, pages, userMenu }

  const pageIdMatch = pathname.match(/\/pages\/([a-f0-9-]{36})/)
  const activePageId = pageIdMatch?.[1] ?? null

  const [fullWidth] = useFullWidth(activePageId ?? '')

  // PageEditorProvider wraps BOTH the toolbar (so PageActionsMenu → PageExportDialog
  // can read the editor via usePageEditor) and the editor content (so PageRenderer
  // can register the editor via setEditor).
  const mainContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <WorkspaceToolbar
        breadcrumbs={breadcrumbs}
        sidebarHidden={hidden}
        onOpenSidebar={() => setHidden(false)}
        sidebarContent={<WorkspaceSidebar {...sidebarProps} />}
        rightSlot={
          activePageId ? (
            <PageActionsToolbar pageId={activePageId} workspaceId={workspace.id} />
          ) : null
        }
      />
      <Box
        sx={{ flex: 1, overflow: 'auto' }}
        data-full-width={fullWidth ? 'true' : 'false'}
        className="page-content-scroll"
      >
        {children}
      </Box>
    </Box>
  )

  return (
    <WorkspaceShell
      sidebarHidden={hidden}
      sidebar={<WorkspaceSidebar {...sidebarProps} onHide={() => setHidden(true)} />}
      main={activePageId ? <PageEditorProvider>{mainContent}</PageEditorProvider> : mainContent}
    />
  )
}
