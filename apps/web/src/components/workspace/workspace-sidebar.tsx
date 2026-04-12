"use client"

import type { ReactNode } from "react"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Box,
  DeleteIcon,
  IconButton,
  KeyboardDoubleArrowLeftIcon,
  SettingsIcon,
  Stack,
  Tooltip,
  Typography,
} from "@repo/ui/components"

import { SIDEBAR_WIDTH } from "./workspace-layout-client"
import { SearchSidebarSection } from "./search-sidebar-section"

type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: PageItem[]
  onHide?: () => void
  userMenu: ReactNode
  userId: string
}

export function WorkspaceSidebar({
  workspace,
  planName,
  pages,
  onHide,
  userMenu,
  userId,
}: Props) {
  const pathname = usePathname()
  return (
    <Box
      component="aside"
      sx={{
        width: SIDEBAR_WIDTH,
        borderRight: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        px: 1.25,
        py: 1.75,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1, pb: 1.75 }}
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
            flexShrink: 0,
          }}
        >
          {workspace.icon ?? "📒"}
        </Box>
        <Stack spacing={0} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {workspace.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {planName} plan
          </Typography>
        </Stack>
        {onHide ? (
          <Tooltip title="Скрыть" placement="right">
            <IconButton size="small" onClick={onHide} sx={{ flexShrink: 0 }}>
              <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>

      <Stack spacing={0.25} sx={{ py: 0.75 }}>
        <SearchSidebarSection workspaceId={workspace.id} />
        <NavItem
          icon={<SettingsIcon sx={{ fontSize: 16 }} />}
          label="Настройки"
          href={`/workspaces/${workspace.id}/settings`}
          matchPrefix={`/workspaces/${workspace.id}/settings`}
          pathname={pathname}
        />
      </Stack>

      <Typography
        variant="overline"
        sx={{ color: "text.disabled", px: 1, pt: 2, pb: 0.5, letterSpacing: "0.06em" }}
      >
        Страницы
      </Typography>
      <Stack spacing={0.25}>
        {pages.map((page) => (
          <NavItem
            key={page.id}
            icon={<span style={{ fontSize: 14 }}>{page.icon ?? "📄"}</span>}
            label={page.title ?? "Untitled"}
            href={`/workspaces/${workspace.id}`}
            pathname={pathname}
          />
        ))}
        <NavItem
          icon={<span style={{ fontSize: 14 }}>＋</span>}
          label="Новая страница"
          href="#"
          pathname={pathname}
          muted
        />
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1.25 }}>
        <NavItem
          icon={<DeleteIcon sx={{ fontSize: 16 }} />}
          label="Корзина"
          href="#"
          matchPrefix="/trash"
          pathname={pathname}
          muted
        />
      </Box>

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>{userMenu}</Box>
    </Box>
  )
}

function NavItem({
  icon,
  label,
  href,
  matchPrefix,
  pathname,
  muted,
}: {
  icon: ReactNode
  label: string
  href: string
  matchPrefix?: string
  pathname: string
  muted?: boolean
}) {
  const active = matchPrefix ? pathname.startsWith(matchPrefix) : false
  return (
    <Box
      component={Link}
      href={href}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.75,
        borderRadius: 0.75,
        textDecoration: "none",
        color: active ? "text.primary" : muted ? "text.disabled" : "text.secondary",
        backgroundColor: active ? "action.selected" : "transparent",
        "&:hover": { backgroundColor: active ? "action.selected" : "action.hover" },
        fontSize: 13,
      }}
    >
      {icon}
      <span>{label}</span>
    </Box>
  )
}
