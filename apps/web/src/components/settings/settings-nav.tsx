"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Box, Stack, Typography } from "@repo/ui/components"

const items = [
  { href: "/settings/general",      label: "Общее",      icon: "⚙" },
  { href: "/settings/account",      label: "Аккаунт",    icon: "◉" },
  { href: "/settings/billing",      label: "Оплата",     icon: "💳" },
  { href: "/settings/integrations", label: "Интеграции", icon: "⇌" },
]

export function SettingsNav() {
  const pathname = usePathname()
  return (
    <Stack spacing={0.25} component="nav" aria-label="Настройки">
      {items.map((item) => {
        const active = pathname?.startsWith(item.href) ?? false
        return (
          <Box
            key={item.href}
            component={Link}
            href={item.href}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              px: 1.25,
              py: 1,
              borderRadius: 1,
              textDecoration: "none",
              color: active ? "text.primary" : "text.secondary",
              fontWeight: active ? 600 : 400,
              backgroundColor: active ? "action.selected" : "transparent",
              "&:hover": { backgroundColor: "action.hover" },
            }}
          >
            <Typography component="span" sx={{ fontSize: 16 }}>{item.icon}</Typography>
            <Typography variant="body2">{item.label}</Typography>
          </Box>
        )
      })}
    </Stack>
  )
}
