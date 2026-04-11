"use client"

import { useEffect, useState, type ReactNode } from "react"

import { Box } from "@repo/ui/components"

import { WorkspaceShell } from "./workspace-shell"
import { WorkspaceSidebar } from "./workspace-sidebar"
import { WorkspaceToolbar } from "./workspace-toolbar"
import { WorkspaceUserMenu } from "./workspace-user-menu"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: Array<{ id: string; title: string | null; icon: string | null }>
  user: { firstName: string; lastName: string; email: string }
  firstPageTitle: string
  firstPageIcon: string | null
  children: ReactNode
}

const STORAGE_KEY = "workspace.sidebar.collapsed"

export function WorkspaceLayoutClient({
  workspace,
  planName,
  pages,
  user,
  firstPageTitle,
  firstPageIcon,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === "true") setCollapsed(true)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed))
  }, [collapsed])

  const sidebarWidth = collapsed ? 56 : 240

  return (
    <WorkspaceShell
      sidebarWidth={sidebarWidth}
      sidebar={
        <WorkspaceSidebar
          workspace={workspace}
          planName={planName}
          pages={pages}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((prev) => !prev)}
          userMenu={<WorkspaceUserMenu user={user} collapsed={collapsed} />}
        />
      }
      main={
        <Box>
          <WorkspaceToolbar
            pageTitle={firstPageTitle}
            pageIcon={firstPageIcon}
            editedLabel="Edited just now"
          />
          {children}
        </Box>
      }
    />
  )
}
