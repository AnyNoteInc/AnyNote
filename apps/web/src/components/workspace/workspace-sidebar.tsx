'use client'

import { type ReactNode, useMemo, useState } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  ArrowDropDownIcon,
  Box,
  DeleteIcon,
  IconButton,
  KeyboardDoubleArrowLeftIcon,
  Menu,
  MenuItem,
  SettingsIcon,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import type { PlanFeatures } from '@repo/trpc'

import { trpc } from '@/trpc/client'

import { FavoritesSection } from './favorites-section'
import { PageTreeSection } from './page-tree-section'
import type { PageItem } from './types'
import { SearchSidebarSection } from './search-sidebar-section'
import { SIDEBAR_WIDTH } from './workspace-layout-client'
import { SidebarSearchTrigger } from '../search/sidebar-search-trigger'

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  features: PlanFeatures
  pages: PageItem[]
  onHide?: () => void
  userMenu: ReactNode
}

export function WorkspaceSidebar({ workspace, features, pages, onHide, userMenu }: Props) {
  const pathname = usePathname()
  const favorites = trpc.page.listFavorites.useQuery({ workspaceId: workspace.id })
  const favoritePageIds = useMemo(
    () => new Set((favorites.data ?? []).map((f) => f.id)),
    [favorites.data],
  )

  const allWorkspaces = trpc.workspace.listMine.useQuery()
  const hasMultiple = (allWorkspaces.data?.length ?? 0) > 1

  const [switcherAnchor, setSwitcherAnchor] = useState<HTMLElement | null>(null)
  const closeSwitcher = () => setSwitcherAnchor(null)

  return (
    <Box
      component="aside"
      sx={{
        width: SIDEBAR_WIDTH,
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        px: 1.25,
        py: 1.75,
        overflow: 'auto',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1, pb: 1.75 }}>
        <Box
          onClick={hasMultiple ? (event) => setSwitcherAnchor(event.currentTarget) : undefined}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flex: 1,
            minWidth: 0,
            borderRadius: 0.75,
            p: 0.5,
            mx: -0.5,
            cursor: hasMultiple ? 'pointer' : 'default',
            '&:hover': hasMultiple ? { bgcolor: 'action.hover' } : undefined,
          }}
        >
          <Box
            sx={{
              width: 24,
              height: 24,
              borderRadius: 0.75,
              background: 'linear-gradient(135deg,#0f766e,#155e75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {workspace.icon ?? '📒'}
          </Box>
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {workspace.name}
          </Typography>
          {hasMultiple && (
            <ArrowDropDownIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
          )}
        </Box>
        {onHide ? (
          <Tooltip title="Скрыть" placement="right">
            <IconButton size="small" onClick={onHide} sx={{ flexShrink: 0 }}>
              <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>

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

      <Stack spacing={0.25} sx={{ py: 0.75 }}>
        <SidebarSearchTrigger />
        {features.chatsEnabled && <SearchSidebarSection workspaceId={workspace.id} />}
        <NavItem
          icon={<SettingsIcon sx={{ fontSize: 16 }} />}
          label="Настройки"
          shortcut={
            typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
              ? '⌘S'
              : 'Alt+S'
          }
          href={`/workspaces/${workspace.id}/settings`}
          matchPrefix={`/workspaces/${workspace.id}/settings`}
          pathname={pathname}
        />
      </Stack>

      <FavoritesSection
        workspaceId={workspace.id}
        allPages={pages}
        favoritePageIds={favoritePageIds}
      />

      <PageTreeSection workspaceId={workspace.id} pages={pages} favoritePageIds={favoritePageIds} />

      <Box sx={{ flex: 1 }} />

      <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
        <NavItem
          icon={<DeleteIcon sx={{ fontSize: 16 }} />}
          label="Корзина"
          href={`/workspaces/${workspace.id}/trash`}
          matchPrefix={`/workspaces/${workspace.id}/trash`}
          pathname={pathname}
        />
      </Box>

      <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>{userMenu}</Box>
    </Box>
  )
}

function NavItem({
  icon,
  label,
  href,
  matchPrefix,
  pathname,
  muted,
  shortcut,
}: {
  icon: ReactNode
  label: string
  href: string
  matchPrefix?: string
  pathname: string
  muted?: boolean
  shortcut?: string
}) {
  const active = matchPrefix ? pathname.startsWith(matchPrefix) : false
  return (
    <Box
      component={Link}
      href={href}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.75,
        borderRadius: 0.75,
        textDecoration: 'none',
        color: active ? 'text.primary' : muted ? 'text.disabled' : 'text.secondary',
        backgroundColor: active ? 'action.selected' : 'transparent',
        '&:hover': { backgroundColor: active ? 'action.selected' : 'action.hover' },
        fontSize: 13,
      }}
    >
      {icon}
      <Box
        component="span"
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Box>
      {shortcut ? (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
          {shortcut}
        </Typography>
      ) : null}
    </Box>
  )
}
