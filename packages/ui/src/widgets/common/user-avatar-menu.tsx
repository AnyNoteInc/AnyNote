'use client'

import { useState } from 'react'
import type { ElementType, MouseEvent } from 'react'
import Avatar from '@mui/material/Avatar'
import Divider from '@mui/material/Divider'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { Box, IconButton, Typography } from '@repo/ui/components'

export type UserAvatarMenuUser = {
  name: string
  email: string
  firstName: string
  lastName: string
  image?: string | null
}

export type UserAvatarMenuItem = {
  label: string
  href: string
  component: ElementType
  disabled?: boolean
}

export type UserAvatarMenuProps = {
  user: UserAvatarMenuUser
  items: UserAvatarMenuItem[]
}

const getInitials = (text: string): string => {
  const parts = text.trim().split(/\s+/).slice(0, 2)
  const initials = parts.map((part) => part[0]).join('')
  return initials.toUpperCase() || 'U'
}

export function UserAvatarMenu({ user, items }: UserAvatarMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)
  const initials = getInitials(user.name)

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }
  const handleClose = () => {
    setAnchorEl(null)
  }

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
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {user.name}
          </Typography>
          {user.email ? (
            <Typography variant="body2" color="text.secondary">
              {user.email}
            </Typography>
          ) : null}
        </Box>
        <Divider />
        {items.map((item) => (
          <MenuItem key={item.label} {...item}>
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
