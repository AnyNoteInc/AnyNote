'use client'

import Link from 'next/link'
import { type MouseEvent, useState } from 'react'

import {
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@repo/ui/components'

import type { SessionType } from '@/lib/get-session'

type NavLink = {
  label: string
  href: string
  color: 'inherit' | 'primary'
  variant: 'text' | 'contained'
}

const guestLinks: NavLink[] = [
  { label: 'Вход', href: '/sign-in', color: 'inherit', variant: 'text' },
  { label: 'Регистрация', href: '/sign-up', color: 'primary', variant: 'contained' },
]

type WorkspaceSummary = { id: string; name: string; icon: string | null }

export type AppUserMenuProps = {
  session?: SessionType
  activeWorkspace?: WorkspaceSummary | null
  hasAnyWorkspace?: boolean
}

const getInitials = (text: string): string => {
  const parts = text.trim().split(/\s+/).slice(0, 2)
  const initials = parts.map((part) => part[0]).join('')
  return initials.toUpperCase() || 'U'
}

export function AppUserMenu({ session, activeWorkspace, hasAnyWorkspace }: AppUserMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)
  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)
  const handleClose = () => setAnchorEl(null)

  if (!session) {
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

  const { user } = session
  const initials = getInitials(user.name)

  return (
    <>
      <IconButton onClick={handleOpen} aria-label="user menu">
        <Avatar src={user.image ?? undefined}>{initials}</Avatar>
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            {user.name}
          </Typography>
          {user.email ? (
            <Typography variant="body2" color="text.secondary" noWrap>
              {user.email}
            </Typography>
          ) : null}
        </Box>
        <Divider />
        {activeWorkspace ? (
          <MenuItem component={Link} href="/app" onClick={handleClose}>
            <Box sx={{ px: 0, py: 0.25, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Активное пространство
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  mt: 0.5,
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: 0.75,
                    background: 'linear-gradient(135deg,#0f766e,#155e75)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    flexShrink: 0,
                  }}
                >
                  {activeWorkspace.icon ?? '📒'}
                </Box>
                <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                  {activeWorkspace.name}
                </Typography>
              </Box>
            </Box>
          </MenuItem>
        ) : !hasAnyWorkspace ? (
          <MenuItem component={Link} href="/workspaces/new" onClick={handleClose}>
            <ListItemText>Создать пространство</ListItemText>
          </MenuItem>
        ) : null}
        {activeWorkspace || !hasAnyWorkspace ? <Divider /> : null}
        <MenuItem component={Link} href="/profile" onClick={handleClose}>
          <ListItemText>Профиль</ListItemText>
        </MenuItem>
        <MenuItem component={Link} href="/settings" onClick={handleClose}>
          <ListItemText>Настройки</ListItemText>
        </MenuItem>
        <MenuItem component={Link} href="/sign-out" onClick={handleClose}>
          <ListItemText>Выйти</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
