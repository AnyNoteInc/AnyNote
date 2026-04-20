"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Box, Stack } from "@repo/ui/components"

type Props = { workspaceId: string }

const ITEMS = [
  { label: "Общее", slug: "general" },
  { label: "Участники", slug: "members" },
  { label: "AI агент", slug: "ai" },
  { label: "Опасная зона", slug: "danger" },
] as const

export function WorkspaceSettingsNav({ workspaceId }: Props) {
  const pathname = usePathname()
  const base = `/workspaces/${workspaceId}/settings`

  return (
    <Stack spacing={0.5} component="nav">
      {ITEMS.map((item) => {
        const href = `${base}/${item.slug}`
        const active = pathname === href
        return (
          <Box
            key={item.slug}
            component={Link}
            href={href}
            sx={{
              display: "block",
              padding: "6px 10px",
              borderRadius: 0.75,
              textDecoration: "none",
              fontSize: 14,
              color: active ? "text.primary" : "text.secondary",
              bgcolor: active ? "action.selected" : "transparent",
              "&:hover": { bgcolor: active ? "action.selected" : "action.hover" },
            }}
          >
            {item.label}
          </Box>
        )
      })}
    </Stack>
  )
}
