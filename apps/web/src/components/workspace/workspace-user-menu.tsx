'use client'

import Link from 'next/link'
import { useState } from 'react'

import {
  ArrowCircleUpIcon,
  Avatar,
  Box,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  LogoutIcon,
  Menu,
  MenuItem,
  PersonIcon,
  SettingsIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import type { PlanFeatures } from '@repo/trpc'

import { getPlanDisplayName } from '@/components/billing/plan-labels'

type Props = {
  user: { firstName: string; lastName: string; email: string; image: string | null }
  features: PlanFeatures
}

export function WorkspaceUserMenu({ user, features }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
  const close = () => setAnchor(null)
  const showUpgrade = features.slug !== 'max'

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
        <Stack spacing={0.25} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
          <Typography variant="body2" noWrap>
            {user.firstName} {user.lastName}
          </Typography>
          <Chip
            label={getPlanDisplayName(features)}
            size="small"
            color={features.isPaid ? 'success' : 'default'}
            variant={features.isPaid ? 'filled' : 'outlined'}
            sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
          />
        </Stack>
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {user.email}
          </Typography>
        </Box>
        <Divider />
        <MenuItem component={Link} href="/profile" onClick={close}>
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Профиль</ListItemText>
        </MenuItem>
        <MenuItem component={Link} href="/settings" onClick={close}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Настройки</ListItemText>
        </MenuItem>
        <Divider />
        {showUpgrade && (
          <MenuItem component={Link} href="/pricing" onClick={close}>
            <ListItemIcon>
              <ArrowCircleUpIcon fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText>Обновить план</ListItemText>
          </MenuItem>
        )}
        <MenuItem component={Link} href="/sign-out" onClick={close}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Выйти</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
