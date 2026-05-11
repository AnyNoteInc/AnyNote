'use client'

import { useState } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  Box,
  ChatBubbleOutlineIcon,
  DeleteIcon,
  IconButton,
  KeyboardDoubleArrowRightIcon,
  Menu,
  MenuItem,
  SearchIcon,
  SettingsIcon,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import type { PlanFeatures } from '@repo/trpc'

import { isMac } from '@/lib/platform'
import { useSearchDialog } from '@/components/search/search-dialog-provider'
import { trpc } from '@/trpc/client'

import { WorkspaceUserMenu } from './workspace-user-menu'

export const SIDEBAR_MINI_WIDTH = 56

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  features: PlanFeatures
  user: { id: string; firstName: string; lastName: string; email: string; image: string | null }
  onExpand: () => void
}

export function WorkspaceSidebarMini({ workspace, features, user, onExpand }: Props) {
  const pathname = usePathname()
  const { open: openSearch } = useSearchDialog()
  const searchHint = isMac() ? '⌘K' : 'Alt+K'

  const allWorkspaces = trpc.workspace.listMine.useQuery()
  const hasMultiple = (allWorkspaces.data?.length ?? 0) > 1
  const [switcherAnchor, setSwitcherAnchor] = useState<HTMLElement | null>(null)
  const closeSwitcher = () => setSwitcherAnchor(null)

  const settingsActive = pathname.startsWith(`/workspaces/${workspace.id}/settings`)
  const trashActive = pathname.startsWith(`/workspaces/${workspace.id}/trash`)
  const chatsActive = pathname.startsWith(`/workspaces/${workspace.id}/chats`)

  return (
    <Box
      component="aside"
      sx={{
        width: SIDEBAR_MINI_WIDTH,
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        bgcolor: 'background.paper',
        py: 1.25,
        gap: 0.5,
      }}
    >
      <Tooltip
        title={hasMultiple ? 'Сменить пространство' : workspace.name}
        placement="right"
      >
        <Box
          onClick={hasMultiple ? (event) => setSwitcherAnchor(event.currentTarget) : undefined}
          aria-label={workspace.name}
          role={hasMultiple ? 'button' : undefined}
          sx={{
            width: 32,
            height: 32,
            borderRadius: 0.75,
            background: 'linear-gradient(135deg,#0f766e,#155e75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            cursor: hasMultiple ? 'pointer' : 'default',
          }}
        >
          {workspace.icon ?? '📒'}
        </Box>
      </Tooltip>

      {hasMultiple && (
        <Menu
          anchorEl={switcherAnchor}
          open={!!switcherAnchor}
          onClose={closeSwitcher}
          slotProps={{ paper: { sx: { minWidth: 240 } } }}
        >
          {(allWorkspaces.data ?? []).map((w) => (
            <MenuItem
              key={w.id}
              component={Link}
              href={`/workspaces/${w.id}`}
              onClick={closeSwitcher}
              selected={w.id === workspace.id}
              sx={{ gap: 1 }}
            >
              <Box
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: 0.5,
                  background: 'linear-gradient(135deg,#0f766e,#155e75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                {w.icon ?? '📒'}
              </Box>
              <Typography variant="body2" noWrap>
                {w.name}
              </Typography>
            </MenuItem>
          ))}
        </Menu>
      )}

      <Tooltip title="Развернуть" placement="right">
        <IconButton
          size="small"
          onClick={onExpand}
          aria-label="Развернуть"
          sx={iconButtonSx(false)}
        >
          <KeyboardDoubleArrowRightIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      <Tooltip title={`Поиск (${searchHint})`} placement="right">
        <IconButton
          size="small"
          onClick={openSearch}
          aria-label="Поиск"
          sx={iconButtonSx(false)}
        >
          <SearchIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      {features.chatsEnabled && (
        <Tooltip title="Чаты" placement="right">
          <IconButton
            size="small"
            component={Link}
            href={`/workspaces/${workspace.id}/chats`}
            aria-label="Чаты"
            sx={iconButtonSx(chatsActive)}
          >
            <ChatBubbleOutlineIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}

      <Tooltip title="Настройки" placement="right">
        <IconButton
          size="small"
          component={Link}
          href={`/workspaces/${workspace.id}/settings`}
          aria-label="Настройки"
          sx={iconButtonSx(settingsActive)}
        >
          <SettingsIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      <Tooltip title="Корзина" placement="right">
        <IconButton
          size="small"
          component={Link}
          href={`/workspaces/${workspace.id}/trash`}
          aria-label="Корзина"
          sx={iconButtonSx(trashActive)}
        >
          <DeleteIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      <Box sx={{ flex: 1 }} />

      <Stack alignItems="center" sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider', width: '100%' }}>
        <WorkspaceUserMenu user={user} features={features} variant="compact" />
      </Stack>
    </Box>
  )
}

function iconButtonSx(active: boolean) {
  return {
    width: 40,
    height: 40,
    borderRadius: 0.75,
    color: active ? 'text.primary' : 'text.secondary',
    bgcolor: active ? 'action.selected' : 'transparent',
    '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
  } as const
}
