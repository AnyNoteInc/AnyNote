"use client"

import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState, type ReactNode } from "react"

import { Box } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

import { WorkspaceShell } from "./workspace-shell"
import { WorkspaceSidebar } from "./workspace-sidebar"
import { WorkspaceToolbar } from "./workspace-toolbar"
import { WorkspaceUserMenu } from "./workspace-user-menu"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: Array<{ id: string; title: string | null; icon: string | null }>
  user: { firstName: string; lastName: string; email: string }
  children: ReactNode
}

const STORAGE_KEY = "workspace.sidebar.collapsed"

export function WorkspaceLayoutClient({ workspace, planName, pages, user, children }: Props) {
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
      if (page) return [base, { label: page.title ?? "Untitled" }]
      return [base]
    }
    return [{ label: workspace.name }]
  }, [pathname, activeChat, pages, workspace.id, workspace.name])

  const userMenu = <WorkspaceUserMenu user={user} />

  const sidebarNode = (
    <WorkspaceSidebar
      workspace={workspace}
      planName={planName}
      pages={pages}
      onHide={() => setHidden(true)}
      userMenu={userMenu}
    />
  )

  return (
    <WorkspaceShell
      sidebarHidden={hidden}
      sidebar={sidebarNode}
      main={
        <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          <WorkspaceToolbar
            breadcrumbs={breadcrumbs}
            sidebarHidden={hidden}
            onOpenSidebar={() => setHidden(false)}
            sidebarContent={sidebarNode}
          />
          <Box sx={{ flex: 1, overflow: "auto" }}>{children}</Box>
        </Box>
      }
    />
  )
}
