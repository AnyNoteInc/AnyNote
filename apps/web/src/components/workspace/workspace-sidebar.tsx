'use client'

import { type ReactNode, useMemo, useState } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  AddIcon,
  ArrowDropDownIcon,
  Box,
  Button,
  ChatBubbleOutlineIcon,
  DashboardCustomizeIcon,
  DeleteIcon,
  Divider,
  GroupAddIcon,
  HomeIcon,
  IconButton,
  KeyboardDoubleArrowLeftIcon,
  Menu,
  MenuItem,
  SearchIcon,
  SettingsIcon,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { isMac } from '@/lib/platform'
import { trpc } from '@/trpc/client'

import { NotificationsBell } from '../notifications/notifications-bell'
import { FavoritesSection } from './favorites-section'
import { PageTreeSection } from './page-tree-section'
import type { PageItem } from './types'
import { SearchSidebarSection } from './search-sidebar-section'
import { SIDEBAR_WIDTH } from './workspace-layout-client'
import type { WorkspaceSidebarSection } from './workspace-layout-client'
import type { PlanFeatures } from '@repo/trpc'
import { useSearchDialog } from '../search/search-dialog-provider'
import { useSettingsDialog } from './settings/settings-dialog-provider'

type Props = Readonly<{
  workspace: { id: string; name: string; icon: string | null }
  features: PlanFeatures
  pages: PageItem[]
  onHide?: () => void
  userMenu: ReactNode
  activeSection: WorkspaceSidebarSection
  onSectionChange: (section: WorkspaceSidebarSection) => void
}>

export function WorkspaceSidebar({
  workspace,
  features,
  pages,
  onHide,
  userMenu,
  activeSection,
  onSectionChange,
}: Props) {
  const pathname = usePathname()
  const searchDialog = useSearchDialog()
  const settings = useSettingsDialog()
  const favorites = trpc.page.listFavorites.useQuery({ workspaceId: workspace.id })
  const favoritePageIds = useMemo(
    () => new Set((favorites.data ?? []).map((f) => f.id)),
    [favorites.data],
  )

  const allWorkspaces = trpc.workspace.listMine.useQuery()

  const [switcherAnchor, setSwitcherAnchor] = useState<HTMLElement | null>(null)
  const closeSwitcher = () => setSwitcherAnchor(null)

  const myRole = trpc.workspace.getMyRole.useQuery({ workspaceId: workspace.id })
  const isOwner = myRole.data === 'OWNER'

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
          onClick={(event) => setSwitcherAnchor(event.currentTarget)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flex: 1,
            minWidth: 0,
            borderRadius: 0.75,
            p: 0.5,
            mx: -0.5,
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <WorkspaceAvatar icon={workspace.icon} />
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {workspace.name}
          </Typography>
          <ArrowDropDownIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
        </Box>
        {onHide ? (
          <Tooltip title="Скрыть" placement="right">
            <IconButton size="small" onClick={onHide} aria-label="Скрыть" sx={{ flexShrink: 0 }}>
              <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>

      <Menu
        anchorEl={switcherAnchor}
        open={!!switcherAnchor}
        onClose={closeSwitcher}
        slotProps={{ paper: { sx: { minWidth: 260 } } }}
      >
        <Box sx={{ px: 1.5, py: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <WorkspaceAvatar icon={workspace.icon} />
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {workspace.name}
            </Typography>
          </Stack>
          {isOwner ? (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SettingsIcon fontSize="small" />}
                onClick={() => {
                  settings.open('general')
                  closeSwitcher()
                }}
                sx={{ textTransform: 'none', flex: 1 }}
              >
                Настройки
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<GroupAddIcon fontSize="small" />}
                onClick={() => {
                  settings.open('members')
                  closeSwitcher()
                }}
                sx={{ textTransform: 'none', flex: 1 }}
              >
                Пригласить
              </Button>
            </Stack>
          ) : null}
        </Box>

        <Divider />

        {(allWorkspaces.data ?? []).map((w) => (
          <MenuItem
            key={w.id}
            component={Link}
            href={`/workspaces/${w.id}`}
            onClick={closeSwitcher}
            selected={w.id === workspace.id}
            sx={{ gap: 1 }}
          >
            <WorkspaceAvatar icon={w.icon} size={22} />
            <Typography variant="body2" noWrap>
              {w.name}
            </Typography>
          </MenuItem>
        ))}

        <Divider />
        <MenuItem component={Link} href="/workspaces/new" onClick={closeSwitcher} sx={{ gap: 1 }}>
          <AddIcon fontSize="small" />
          <Typography variant="body2">Создать пространство</Typography>
        </MenuItem>
      </Menu>

      <WorkspaceSectionSwitcher
        activeSection={activeSection}
        chatsEnabled={features.chatsEnabled}
        onChats={() => {
          onSectionChange('chats')
        }}
        onPages={() => onSectionChange('pages')}
        onSearch={searchDialog.open}
      />

      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 1,
          minHeight: 0,
          py: 0.75,
        }}
      >
        {activeSection === 'chats' && features.chatsEnabled ? (
          <SearchSidebarSection workspaceId={workspace.id} />
        ) : null}

        {activeSection === 'pages' ? (
          <>
            <FavoritesSection
              workspaceId={workspace.id}
              allPages={pages}
              favoritePageIds={favoritePageIds}
            />
            <PageTreeSection
              workspaceId={workspace.id}
              pages={pages}
              favoritePageIds={favoritePageIds}
            />
            <Stack spacing={0.25} sx={{ pb: 1 }}>
              <NavItem
                icon={<DashboardCustomizeIcon sx={{ fontSize: 16 }} />}
                label="Шаблоны"
                href={`/workspaces/${workspace.id}/templates`}
                matchPrefix={`/workspaces/${workspace.id}/templates`}
                pathname={pathname}
              />
              <NavItem
                icon={<DeleteIcon sx={{ fontSize: 16 }} />}
                label="Корзина"
                href={`/workspaces/${workspace.id}/trash`}
                matchPrefix={`/workspaces/${workspace.id}/trash`}
                pathname={pathname}
              />
            </Stack>
          </>
        ) : null}
      </Box>

      <Box
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          pt: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>{userMenu}</Box>
        <NotificationsBell tooltipPlacement="top" />
      </Box>
    </Box>
  )
}

export function WorkspaceSectionSwitcher({
  activeSection,
  chatsEnabled,
  onChats,
  onPages,
  onSearch,
}: {
  activeSection: WorkspaceSidebarSection
  chatsEnabled: boolean
  onChats: () => void
  onPages: () => void
  onSearch: () => void
}) {
  const mac = isMac()
  const shortcut = (macLabel: string, otherLabel: string) => (mac ? macLabel : otherLabel)

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <SectionButton
        active={activeSection === 'pages'}
        icon={<HomeIcon fontSize="small" />}
        label="Домашняя"
        ariaLabel="Домашняя"
        tooltip={`Домашняя (${shortcut('⌘D', 'Alt+D')})`}
        onClick={onPages}
      />
      {chatsEnabled ? (
        <SectionButton
          active={activeSection === 'chats'}
          icon={<ChatBubbleOutlineIcon fontSize="small" />}
          label="Чаты"
          ariaLabel="Чаты"
          tooltip={`Чаты (${shortcut('⌘P', 'Alt+P')})`}
          onClick={onChats}
        />
      ) : null}
      <SectionButton
        active={false}
        icon={<SearchIcon fontSize="small" />}
        label="Поиск"
        ariaLabel="Поиск"
        tooltip={`Поиск (${shortcut('⌘K', 'Alt+K')})`}
        onClick={onSearch}
      />
    </Stack>
  )
}

const SECTION_ACTIVE_SX = {
  backgroundColor: 'rgba(201, 100, 66, 0.14)',
  color: '#c96442',
} as const

function SectionButton({
  active,
  icon,
  label,
  ariaLabel,
  tooltip,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  ariaLabel: string
  tooltip: string
  onClick: () => void
}) {
  if (active) {
    return (
      <Button
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed
        startIcon={icon}
        size="medium"
        sx={{
          flex: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          textTransform: 'none',
          ...SECTION_ACTIVE_SX,
          '&:hover': SECTION_ACTIVE_SX,
        }}
      >
        {label}
      </Button>
    )
  }
  return (
    <Tooltip title={tooltip}>
      <IconButton onClick={onClick} aria-label={ariaLabel} size="medium" sx={{ flexShrink: 0 }}>
        {icon}
      </IconButton>
    </Tooltip>
  )
}

function WorkspaceAvatar({ icon, size = 24 }: { icon: string | null; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: 0.75,
        background: 'linear-gradient(135deg,#0f766e,#155e75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.58),
        flexShrink: 0,
      }}
    >
      {icon ?? '📒'}
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
