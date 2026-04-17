"use client"

import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState, type ReactNode } from "react"

import { Box } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

import { WorkspaceShell } from "./workspace-shell"
import { WorkspaceSidebar } from "./workspace-sidebar"
import { WorkspaceToolbar } from "./workspace-toolbar"
import { WorkspaceUserMenu } from "./workspace-user-menu"
import type { PageItem } from "./types"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: PageItem[]
  user: { id: string; firstName: string; lastName: string; email: string; image: string | null }
  children: ReactNode
}

const STORAGE_KEY = "workspace.sidebar.collapsed"
export const SIDEBAR_WIDTH = 313

export function WorkspaceLayoutClient({
  workspace,
  planName,
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
    if (stored === "true") setHidden(true)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(hidden))
  }, [hidden])

  const chatIdMatch = pathname.match(/\/search\/([a-f0-9-]{36})$/)
  const activeChatId = chatIdMatch?.[1] ?? null

  const chats = trpc.search.listChats.useQuery(
    { workspaceId: workspace.id },
    { enabled: activeChatId !== null },
  )
  const activeChat = activeChatId ? (chats.data?.find((c) => c.id === activeChatId) ?? null) : null

  const breadcrumbs = useMemo(() => {
    if (pathname.includes("/search")) {
      const base = { label: "Поиск", href: `/workspaces/${workspace.id}/search` }
      if (activeChat) return [base, { label: activeChat.title ?? "Без названия" }]
      return [base]
    }
    if (pathname.includes("/settings")) {
      return [{ label: "Настройки" }]
    }
    if (pathname.includes("/trash")) {
      return [{ label: "Корзина" }]
    }
    const pageIdMatch = pathname.match(/\/pages\/([a-f0-9-]{36})/)
    if (pageIdMatch) {
      const page = pages.find((p) => p.id === pageIdMatch[1])
      const base = { label: "Страницы" }
      if (page) return [base, { label: page.title ?? "Без названия" }]
      return [base]
    }
    return [{ label: workspace.name }]
  }, [pathname, activeChat, pages, workspace.id, workspace.name])

  useEffect(() => {
    const title = breadcrumbs.map((b) => b.label).join(" / ")
    document.title = title ? `${title} — AnyNote` : "AnyNote"
  }, [breadcrumbs])

  const userMenu = <WorkspaceUserMenu user={user} />

  const sidebarProps = { workspace, planName, pages, userMenu }

  return (
    <WorkspaceShell
      sidebarHidden={hidden}
      sidebar={<WorkspaceSidebar {...sidebarProps} onHide={() => setHidden(true)} />}
      main={
        <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          <WorkspaceToolbar
            breadcrumbs={breadcrumbs}
            sidebarHidden={hidden}
            onOpenSidebar={() => setHidden(false)}
            sidebarContent={<WorkspaceSidebar {...sidebarProps} />}
          />
          <Box sx={{ flex: 1, overflow: "auto" }}>{children}</Box>
        </Box>
      }
    />
  )
}
