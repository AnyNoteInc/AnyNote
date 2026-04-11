"use client"

import Link from "next/link"

import { Button } from "@repo/ui/components"
import { UserAvatarMenu, type UserAvatarMenuItem } from "@repo/ui/widgets"

import type { SessionType } from "@/lib/get-session"

type NavLink = {
  label: string
  href: string
  color: "inherit" | "primary"
  variant: "text" | "contained"
}

const guestLinks: NavLink[] = [
  { label: "Вход", href: "/sign-in", color: "inherit", variant: "text" },
  { label: "Регистрация", href: "/sign-up", color: "primary", variant: "contained" },
]

const userMenuItems: UserAvatarMenuItem[] = [
  { label: "Профиль", href: "/profile", component: Link },
  { label: "Настройки", href: "/settings", component: Link },
  { label: "Выйти", href: "/sign-out", component: Link },
]

export type AppUserMenuProps = {
  session?: SessionType
}

export function AppUserMenu({ session }: AppUserMenuProps) {
  if (session) {
    return <UserAvatarMenu user={session.user} items={userMenuItems} />
  }

  return (
    <>
      {guestLinks.map(({ label, href, color, variant }) => (
        <Button key={href} component={Link} href={href} color={color} variant={variant}>
          {label}
        </Button>
      ))}
    </>
  )
}
