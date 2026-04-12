"use client"

import type { ReactNode } from "react"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Box,
  LeakAddIcon,
  PaymentIcon,
  PersonIcon,
  SettingsIcon,
  Stack,
  Typography,
} from "@repo/ui/components"

const items: Array<{ href: string; label: string; icon: ReactNode }> = [
  { href: "/settings/general", label: "Общее", icon: <SettingsIcon fontSize="small" /> },
  { href: "/settings/account", label: "Аккаунт", icon: <PersonIcon fontSize="small" /> },
  { href: "/settings/billing", label: "Оплата", icon: <PaymentIcon fontSize="small" /> },
  {
    href: "/settings/integrations",
    label: "Интеграции",
    icon: <LeakAddIcon fontSize="small" />,
  },
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
            {item.icon}
            <Typography variant="body2">{item.label}</Typography>
          </Box>
        )
      })}
    </Stack>
  )
}
