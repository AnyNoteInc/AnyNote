'use client'

import Link from 'next/link'
import { useState } from 'react'

import {
  ArrowCircleUpIcon,
  Avatar,
  Box,
  Button,
  ButtonGroup,
  Chip,
  DarkModeRoundedIcon,
  Divider,
  DevicesRoundedIcon,
  InstallDesktopIcon,
  LightModeRoundedIcon,
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
import { useThemeMode } from '@repo/ui/providers'

import type { PlanFeatures } from '@repo/trpc'

import { getPlanDisplayName } from '@/components/billing/plan-labels'
import { usePwaInstall } from '@/components/pwa/pwa-install-context'
import { trpc } from '@/trpc/client'

type Props = Readonly<{
  user: { firstName: string; lastName: string; email: string; image: string | null }
  features: PlanFeatures
  workspace: { name: string; icon: string | null }
}>

type Theme = 'light' | 'dark' | 'system'

const themeOptions: Array<{
  value: Theme
  label: string
  icon: React.ReactNode
}> = [
  { value: 'system', label: 'Системная тема', icon: <DevicesRoundedIcon fontSize="small" /> },
  { value: 'light', label: 'Светлая тема', icon: <LightModeRoundedIcon fontSize="small" /> },
  { value: 'dark', label: 'Тёмная тема', icon: <DarkModeRoundedIcon fontSize="small" /> },
]

export function WorkspaceUserMenu({ user, features, workspace }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { preference, setPreference } = useThemeMode()
  const { canInstall, promptInstall } = usePwaInstall()
  const setTheme = trpc.user.setTheme.useMutation()
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
  const close = () => setAnchor(null)
  const showUpgrade = features.slug !== 'max'
  const chooseTheme = (theme: Theme) => {
    setPreference(theme)
    document.cookie = `theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`
    setTheme.mutate({ theme })
  }

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
        <Box sx={{ px: 2, pt: 1, pb: 1, minWidth: 220 }}>
          <Typography variant="caption" color="text.secondary" display="block">
            Активное пространство
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
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
              {workspace.icon ?? '📒'}
            </Box>
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
              {workspace.name}
            </Typography>
          </Stack>
        </Box>
        <Divider />
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
        <Box sx={{ px: 2, py: 1 }}>
          <Typography id="workspace-user-menu-theme-label" variant="caption" color="text.secondary">
            Тема
          </Typography>
          <ButtonGroup
            aria-labelledby="workspace-user-menu-theme-label"
            variant="text"
            size="small"
            fullWidth
            sx={{ mt: 0.5 }}
          >
            {themeOptions.map((option) => (
              <Button
                key={option.value}
                aria-label={option.label}
                aria-pressed={preference === option.value}
                color={preference === option.value ? 'primary' : 'inherit'}
                onClick={() => chooseTheme(option.value)}
                sx={{ minWidth: 0 }}
              >
                {option.icon}
              </Button>
            ))}
          </ButtonGroup>
        </Box>
        <Divider />
        <Box data-testid="workspace-user-menu-actions">
          {canInstall && (
            <MenuItem
              data-testid="pwa-install-menu-item"
              onClick={() => {
                void promptInstall()
                close()
              }}
            >
              <ListItemIcon>
                <InstallDesktopIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Установить приложение</ListItemText>
            </MenuItem>
          )}
          {showUpgrade && (
            <>
              <MenuItem component={Link} href="/pricing" onClick={close}>
                <ListItemIcon>
                  <ArrowCircleUpIcon fontSize="small" color="primary" />
                </ListItemIcon>
                <ListItemText>Обновить план</ListItemText>
              </MenuItem>
              <Divider />
            </>
          )}
          <MenuItem component={Link} href="/sign-out" onClick={close}>
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Выйти</ListItemText>
          </MenuItem>
        </Box>
      </Menu>
    </>
  )
}
