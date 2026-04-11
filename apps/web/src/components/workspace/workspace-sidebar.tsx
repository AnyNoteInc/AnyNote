"use client"

import type { ReactNode } from "react"

import Link from "next/link"

import { Box, Stack, Tooltip, Typography } from "@repo/ui/components"

import { SearchSidebarSection } from "./search-sidebar-section"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: Array<{ id: string; title: string | null; icon: string | null }>
  collapsed: boolean
  onToggleCollapsed: () => void
  userMenu: ReactNode
}

export function WorkspaceSidebar({
  workspace,
  planName,
  pages,
  collapsed,
  onToggleCollapsed,
  userMenu,
}: Props) {
  const width = collapsed ? 56 : 240
  return (
    <Box
      component="aside"
      sx={{
        width,
        borderRight: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        px: collapsed ? 0.5 : 1.25,
        py: 1.75,
        transition: "width 150ms ease",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: collapsed ? 0 : 1,
          pb: 1.75,
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: 0.75,
            background: "linear-gradient(135deg,#0f766e,#155e75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}
        >
          {workspace.icon ?? "📒"}
        </Box>
        {collapsed ? null : (
          <Stack spacing={0}>
            <Typography variant="body2">{workspace.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {planName} plan
            </Typography>
          </Stack>
        )}
      </Stack>

      <Stack spacing={0.25} sx={{ py: 0.75 }}>
        <SearchSidebarSection workspaceId={workspace.id} collapsed={collapsed} />
        <NavItem
          icon="⚙"
          label="Настройки"
          href={`/workspaces/${workspace.id}/settings`}
          collapsed={collapsed}
        />
      </Stack>

      {collapsed ? null : (
        <Typography
          variant="overline"
          sx={{ color: "text.disabled", px: 1, pt: 2, pb: 0.5, letterSpacing: "0.06em" }}
        >
          Страницы
        </Typography>
      )}
      <Stack spacing={0.25}>
        {pages.map((page) => (
          <NavItem
            key={page.id}
            icon={page.icon ?? "📄"}
            label={page.title ?? "Untitled"}
            href={`/workspaces/${workspace.id}`}
            collapsed={collapsed}
          />
        ))}
        <NavItem icon="＋" label="Новая страница" href="#" collapsed={collapsed} muted />
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1.25 }}>
        <NavItem icon="🗑" label="Корзина" href="#" collapsed={collapsed} muted />
      </Box>

      <Box
        onClick={onToggleCollapsed}
        sx={{
          cursor: "pointer",
          textAlign: "center",
          color: "text.disabled",
          py: 0.75,
          "&:hover": { color: "text.primary" },
        }}
      >
        {collapsed ? "▸" : "◂"}
      </Box>

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>{userMenu}</Box>
    </Box>
  )
}

function NavItem({
  icon,
  label,
  href,
  collapsed,
  active,
  muted,
}: {
  icon: string
  label: string
  href: string
  collapsed: boolean
  active?: boolean
  muted?: boolean
}) {
  const body = (
    <Box
      component={Link}
      href={href}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: collapsed ? 0 : 1,
        py: 0.75,
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 0.75,
        textDecoration: "none",
        color: active
          ? "text.primary"
          : muted
            ? "text.disabled"
            : "text.secondary",
        backgroundColor: active ? "action.selected" : "transparent",
        "&:hover": { backgroundColor: active ? "action.selected" : "action.hover" },
        fontSize: 13,
      }}
    >
      <span>{icon}</span>
      {collapsed ? null : <span>{label}</span>}
    </Box>
  )
  if (collapsed) {
    return (
      <Tooltip title={label} placement="right">
        {body}
      </Tooltip>
    )
  }
  return body
}
