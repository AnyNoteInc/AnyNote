'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { List, ListItemButton, Typography } from '@repo/ui/components'

const navItems = [
  { label: 'Обзор', href: '/developers' },
  { label: 'REST API', href: '/developers/api' },
  { label: 'Вебхуки', href: '/developers/webhooks' },
  { label: 'Телеграм', href: '/developers/telegram' },
  { label: 'Изменения API', href: '/developers/changelog' },
] as const

export function DevelopersNav() {
  const pathname = usePathname()

  return (
    <List
      component="nav"
      aria-label="Разделы документации для разработчиков"
      sx={{
        display: 'flex',
        flexDirection: { xs: 'row', md: 'column' },
        gap: 0.5,
        p: 0,
        overflowX: { xs: 'auto', md: 'visible' },
      }}
    >
      {navItems.map((item) => {
        const active = pathname === item.href
        return (
          <ListItemButton
            key={item.href}
            component={Link}
            href={item.href}
            selected={active}
            aria-current={active ? 'page' : undefined}
            sx={{
              borderRadius: 1.5,
              px: 1.5,
              py: 0.75,
              flexGrow: 0,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: active ? 600 : 400 }}
              color={active ? 'text.primary' : 'text.secondary'}
            >
              {item.label}
            </Typography>
          </ListItemButton>
        )
      })}
    </List>
  )
}
