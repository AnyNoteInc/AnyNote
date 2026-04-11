"use client"

import Link from "next/link"

import { Box, Stack, Typography } from "@repo/ui/components"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
}

export function WorkspaceSidebar({ workspace, planName }: Props) {
  return (
    <Box
      component="aside"
      sx={{
        borderRight: "1px solid #1e2024",
        display: "flex",
        flexDirection: "column",
        px: 1.25,
        py: 1.75,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, pb: 1.75 }}>
        <Box
          sx={{
            width: 20,
            height: 20,
            borderRadius: 0.75,
            background: "linear-gradient(135deg,#4a9eff,#9c7bff)",
          }}
        />
        <Stack spacing={0}>
          <Typography variant="body2" fontWeight={600}>
            {workspace.icon ? `${workspace.icon} ` : ""}
            {workspace.name}
          </Typography>
          <Typography variant="caption" sx={{ color: "#6b6e75" }}>
            {planName} plan
          </Typography>
        </Stack>
      </Stack>

      <Stack spacing={0.25} sx={{ py: 0.75 }}>
        <NavItem icon="⌕" label="Поиск" href="#" />
        <NavItem icon="⌂" label="Главная" href={`/workspaces/${workspace.id}`} />
        <NavItem icon="⚙" label="Настройки" href="/settings/general" />
      </Stack>

      <Typography
        variant="overline"
        sx={{ color: "#6b6e75", px: 1, pt: 2, pb: 0.5, letterSpacing: "0.06em" }}
      >
        Страницы
      </Typography>
      <Stack spacing={0.25}>
        <NavItem icon="👋" label="Welcome to AnyNote" href={`/workspaces/${workspace.id}`} active />
        <NavItem icon="＋" label="Новая страница" href="#" muted />
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ borderTop: "1px solid #1e2024", pt: 1.25 }}>
        <NavItem icon="🗑" label="Корзина" href="#" muted />
      </Box>
    </Box>
  )
}

function NavItem({
  icon,
  label,
  href,
  active,
  muted,
}: {
  icon: string
  label: string
  href: string
  active?: boolean
  muted?: boolean
}) {
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
        color: active ? "#f0f1f3" : muted ? "#6b6e75" : "#a7aab1",
        backgroundColor: active ? "#1a1c20" : "transparent",
        "&:hover": { backgroundColor: active ? "#1a1c20" : "#141619" },
        fontSize: 13,
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </Box>
  )
}
