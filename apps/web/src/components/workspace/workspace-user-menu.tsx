'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Avatar, Box, Menu, MenuItem, Stack, Typography } from '@repo/ui/components'

import { signOut } from '@/lib/auth-client'

type Props = {
  user: { firstName: string; lastName: string; email: string; image: string | null }
}

export function WorkspaceUserMenu({ user }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()

  return (
    <>
      <Box
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 0.75,
          borderRadius: 0.75,
          cursor: 'pointer',
          justifyContent: 'flex-start',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Avatar
          src={user.image ?? undefined}
          sx={{
            width: 28,
            height: 28,
            fontSize: 13,
            background: 'linear-gradient(135deg,#0f766e,#155e75)',
          }}
        >
          {initials}
        </Avatar>
        <Stack spacing={0} sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {user.firstName} {user.lastName}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {user.email}
          </Typography>
        </Stack>
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem component={Link} href="/profile" onClick={() => setAnchor(null)}>
          Мой профиль
        </MenuItem>
        <MenuItem component={Link} href="/settings/general" onClick={() => setAnchor(null)}>
          Настройки
        </MenuItem>
        <MenuItem
          onClick={async () => {
            setAnchor(null)
            await signOut()
          }}
        >
          Выйти
        </MenuItem>
      </Menu>
    </>
  )
}
