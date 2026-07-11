'use client'

import { type ReactNode, useMemo, useState } from 'react'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import {
  AddIcon,
  ArrowDropDownIcon,
  Box,
  Button,
  ChatBubbleOutlineIcon,
  Chip,
  DashboardCustomizeIcon,
  DeleteIcon,
  Divider,
  GroupAddIcon,
  GroupIcon,
  HomeIcon,
  IconButton,
  Inventory2Icon,
  KeyboardDoubleArrowLeftIcon,
  LockIcon,
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
import { PageIcon } from '@/components/page/page-icon'

import { NotificationsBell } from '../notifications/notifications-bell'
import {
  DOMAIN_JOIN_LIST_QUERY_OPTS,
  DomainJoinConfirmDialog,
  type DomainJoinTarget,
} from './domain-join-banner'
import { FavoritesSection } from './favorites-section'
import { GuestPagesSection } from './guest-pages-section'
import { PageTreeSection } from './page-tree-section'
import { SharedPagesSection } from './shared-pages-section'
import { SIDEBAR_ZONES, SidebarDndProvider, SidebarDropZone } from './sidebar-dnd-context'
import type { PageItem } from './types'
import { SearchSidebarSection } from './search-sidebar-section'
import type { WorkspaceAccessKind, WorkspaceSidebarSection } from './workspace-layout-client'
import { WorkspaceAvatar } from './workspace-avatar'
import type { PlanFeatures } from '@repo/trpc'
import { useSearchDialog } from '../search/search-dialog-provider'
import { useSettingsDialog } from './settings/settings-dialog-provider'

type Props = Readonly<{
  workspace: { id: string; name: string; icon: string | null }
  /** 'guest' = grant-only access: the sidebar collapses to «Доступные мне». */
  accessKind: WorkspaceAccessKind
  features: PlanFeatures
  pages: PageItem[]
  onHide?: () => void
  userMenu: ReactNode
  activeSection: WorkspaceSidebarSection
  onSectionChange: (section: WorkspaceSidebarSection) => void
}>

export function WorkspaceSidebar({
  workspace,
  accessKind,
  features,
  pages,
  onHide,
  userMenu,
  activeSection,
  onSectionChange,
}: Props) {
  const isGuest = accessKind === 'guest'
  const pathname = usePathname()
  const router = useRouter()
  const searchDialog = useSearchDialog()
  const settings = useSettingsDialog()
  const utils = trpc.useUtils()
  // Favorites/collections are member-gated server-side — never fetched for guests.
  const favorites = trpc.page.listFavorites.useQuery(
    { workspaceId: workspace.id },
    { enabled: !isGuest },
  )
  const favoritePageIds = useMemo(
    () => new Set((favorites.data ?? []).map((f) => f.id)),
    [favorites.data],
  )

  const collections = trpc.collection.list.useQuery(
    { workspaceId: workspace.id },
    { enabled: !isGuest },
  )
  const teamCollectionId = collections.data?.find((c) => c.kind === 'TEAM')?.id ?? null
  const personalCollectionId = collections.data?.find((c) => c.kind === 'PERSONAL')?.id ?? null

  // "Прикрепленные коллекции": there is no pin flag in the data model — a
  // workspace bootstraps exactly one primary TEAM («Команда») and the user's
  // PERSONAL («Личное») collection, both already rendered as roots above.
  // Render any OTHER collection the user can see (extra team/site collections,
  // should they ever exist) as additional first-level roots BELOW the three.
  const pinnedCollections = useMemo(
    () =>
      (collections.data ?? []).filter(
        (c) => c.id !== teamCollectionId && c.id !== personalCollectionId,
      ),
    [collections.data, teamCollectionId, personalCollectionId],
  )

  const allWorkspaces = trpc.workspace.listMine.useQuery()

  const setActive = trpc.workspace.setActive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.page.listByWorkspace.invalidate(),
        utils.page.listFavorites.invalidate(),
        utils.chat.listChats.invalidate(),
        utils.workspace.getActive.invalidate(),
      ])
      router.push('/app')
      router.refresh()
    },
  })

  const [switcherAnchor, setSwitcherAnchor] = useState<HTMLElement | null>(null)
  const closeSwitcher = () => setSwitcherAnchor(null)

  // Workspaces joinable via the user's e-mail domain (identity spec §6):
  // rendered as «По домену» switcher entries — joining is explicit (confirm
  // dialog, billable member seat), never a silent membership.
  const domainJoinable = trpc.identity.domainJoin.listAvailable.useQuery(
    undefined,
    DOMAIN_JOIN_LIST_QUERY_OPTS,
  )
  const [joinTarget, setJoinTarget] = useState<DomainJoinTarget | null>(null)

  const myRole = trpc.workspace.getMyRole.useQuery({ workspaceId: workspace.id })
  // Settings entry: OWNER and ADMIN (people management lives there); the
  // dialog itself hides billing/security-adjacent sections from ADMIN.
  const canOpenSettings = myRole.data === 'OWNER' || myRole.data === 'ADMIN'

  return (
    <Box
      component="aside"
      sx={{
        // The host decides the width: the shell's resizable grid column, or
        // the toolbar popper's fixed-width Paper (hidden mode).
        width: '100%',
        minWidth: 0,
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        px: 1.25,
        py: 1.75,
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" spacing={0.5} sx={{ px: 1, pb: 1.75, alignItems: 'center' }}>
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
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <WorkspaceAvatar icon={workspace.icon} />
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {workspace.name}
            </Typography>
          </Stack>
          {canOpenSettings ? (
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
            onClick={() => {
              closeSwitcher()
              if (w.id !== workspace.id) setActive.mutate({ workspaceId: w.id })
            }}
            selected={w.id === workspace.id}
            sx={{ gap: 1 }}
          >
            <WorkspaceAvatar icon={w.icon} size={22} />
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {w.name}
            </Typography>
            {w.accessKind === 'guest' ? (
              <Chip label="Гость" size="small" variant="outlined" data-testid="guest-chip" />
            ) : null}
          </MenuItem>
        ))}

        {(domainJoinable.data ?? []).map((w) => (
          <MenuItem
            key={w.workspaceId}
            data-testid="domain-join-switcher-entry"
            onClick={() => {
              closeSwitcher()
              setJoinTarget(w)
            }}
            sx={{ gap: 1 }}
          >
            <WorkspaceAvatar icon={null} size={22} />
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {w.name}
            </Typography>
            <Chip label="По домену" size="small" variant="outlined" data-testid="domain-chip" />
          </MenuItem>
        ))}

        <Divider />
        <MenuItem component={Link} href="/workspaces/new" onClick={closeSwitcher} sx={{ gap: 1 }}>
          <AddIcon fontSize="small" />
          <Typography variant="body2">Создать пространство</Typography>
        </MenuItem>
      </Menu>
      {/* Guests get no section switcher: chats and search are member-gated. */}
      {isGuest ? null : (
        <WorkspaceSectionSwitcher
          activeSection={activeSection}
          chatsEnabled={features.chatsEnabled}
          onChats={() => {
            onSectionChange('chats')
          }}
          onPages={() => onSectionChange('pages')}
          onSearch={searchDialog.open}
        />
      )}
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 1,
          minHeight: 0,
        }}
      >
        {isGuest ? (
          // A guest's whole sidebar (people spec §5): the flat granted-pages
          // list — no favorites, collections, marketplace, archive or trash.
          <GuestPagesSection workspaceId={workspace.id} />
        ) : null}

        {!isGuest && activeSection === 'chats' && features.chatsEnabled ? (
          <SearchSidebarSection workspaceId={workspace.id} />
        ) : null}

        {!isGuest && activeSection === 'pages' ? (
          // One DndContext for the whole pages area so a page can be dragged
          // across sections (favorite/move) and onto Archive/Trash.
          <SidebarDndProvider workspaceId={workspace.id}>
            {/* Only the page list scrolls — from the section tabs down to the
                pinned bottom links. Both this scroll Box and the fixed bottom
                Box stay inside SidebarDndProvider so the Archive/Trash drop
                zones share the one DndContext (drag across the split works). */}
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                py: 0.75,
                // Reserve room so the (overlay) scrollbar never overlaps the
                // section headers' "+" buttons / row affordances at the right
                // edge — macOS overlay scrollbars take 0 layout width and paint
                // on top, so an explicit right inset is required.
                pr: 1.5,
              }}
            >
              <FavoritesSection
                workspaceId={workspace.id}
                allPages={pages}
                favoritePageIds={favoritePageIds}
              />
              {teamCollectionId ? (
                <PageTreeSection
                  workspaceId={workspace.id}
                  pages={pages}
                  favoritePageIds={favoritePageIds}
                  collectionId={teamCollectionId}
                  title="Команда"
                  location="team"
                  headerIcon={<GroupIcon sx={{ fontSize: 16 }} />}
                />
              ) : null}
              {personalCollectionId ? (
                <PageTreeSection
                  workspaceId={workspace.id}
                  pages={pages}
                  favoritePageIds={favoritePageIds}
                  collectionId={personalCollectionId}
                  title="Личное"
                  location="private"
                  headerIcon={<LockIcon sx={{ fontSize: 16 }} />}
                />
              ) : null}
              {/* Прикрепленные коллекции: additional collections (if any) as roots below. */}
              {pinnedCollections.map((c) => (
                <PageTreeSection
                  key={c.id}
                  workspaceId={workspace.id}
                  pages={pages}
                  favoritePageIds={favoritePageIds}
                  collectionId={c.id}
                  title={c.title ?? 'Коллекция'}
                  headerIcon={
                    c.icon ? (
                      <PageIcon icon={c.icon} size={16} />
                    ) : (
                      <GroupIcon sx={{ fontSize: 16 }} />
                    )
                  }
                />
              ))}
              <SharedPagesSection workspaceId={workspace.id} />
            </Box>
            {/* Pinned bottom links — never scroll; sit above the profile footer. */}
            <Box sx={{ flexShrink: 0 }}>
              <Stack spacing={0.25} sx={{ pt: 0.75 }}>
                <NavItem
                  icon={<DashboardCustomizeIcon sx={{ fontSize: 16 }} />}
                  label="Маркетплейс"
                  href="/marketplace"
                  matchPrefix="/marketplace"
                  pathname={pathname}
                />
                <SidebarDropZone zoneId={SIDEBAR_ZONES.archive}>
                  {({ isOver, setNodeRef }) => (
                    <NavItem
                      icon={<Inventory2Icon sx={{ fontSize: 16 }} />}
                      label="Архив"
                      href="/archive"
                      matchPrefix="/archive"
                      pathname={pathname}
                      dropRef={setNodeRef}
                      isDropOver={isOver}
                    />
                  )}
                </SidebarDropZone>
                <SidebarDropZone zoneId={SIDEBAR_ZONES.trash}>
                  {({ isOver, setNodeRef }) => (
                    <NavItem
                      icon={<DeleteIcon sx={{ fontSize: 16 }} />}
                      label="Корзина"
                      href="/trash"
                      matchPrefix="/trash"
                      pathname={pathname}
                      dropRef={setNodeRef}
                      isDropOver={isOver}
                    />
                  )}
                </SidebarDropZone>
              </Stack>
            </Box>
          </SidebarDndProvider>
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
      {joinTarget ? (
        <DomainJoinConfirmDialog target={joinTarget} onClose={() => setJoinTarget(null)} />
      ) : null}
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

const SECTION_ACTIVE_COLOR = '#c96442'
const SECTION_ACTIVE_BG = 'rgba(201, 100, 66, 0.14)'
const SECTION_ACTIVE_BG_HOVER = 'rgba(201, 100, 66, 0.2)'
const SECTION_TRANSITION =
  'flex-grow 0.28s cubic-bezier(0.2, 0, 0, 1), background-color 0.2s ease, color 0.2s ease'

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
  const button = (
    <Button
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      startIcon={icon}
      size="medium"
      disableElevation
      sx={{
        flexGrow: active ? 1 : 0,
        flexShrink: 0,
        minWidth: 0,
        justifyContent: 'flex-start',
        textTransform: 'none',
        borderRadius: 999,
        boxShadow: 'none',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        transition: SECTION_TRANSITION,
        color: active ? SECTION_ACTIVE_COLOR : 'text.secondary',
        backgroundColor: active ? SECTION_ACTIVE_BG : 'transparent',
        '& .MuiButton-startIcon': { mr: active ? 1 : 0, transition: 'margin 0.28s ease' },
        '&:hover': {
          boxShadow: 'none',
          backgroundColor: active ? SECTION_ACTIVE_BG_HOVER : 'action.hover',
          color: active ? SECTION_ACTIVE_COLOR : 'text.primary',
        },
        // Collapse the label to zero width when inactive so it animates open/closed.
        '& .section-button-label': {
          maxWidth: active ? 160 : 0,
          opacity: active ? 1 : 0,
          transition: 'max-width 0.28s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease',
        },
      }}
    >
      <Box component="span" className="section-button-label" sx={{ overflow: 'hidden' }}>
        {label}
      </Box>
    </Button>
  )
  if (active) return button
  return <Tooltip title={tooltip}>{button}</Tooltip>
}

function NavItem({
  icon,
  label,
  href,
  matchPrefix,
  pathname,
  muted,
  shortcut,
  dropRef,
  isDropOver,
}: {
  icon: ReactNode
  label: string
  href: string
  matchPrefix?: string
  pathname: string
  muted?: boolean
  shortcut?: string
  /** When set, this nav link doubles as a drag-and-drop target. */
  dropRef?: (el: HTMLElement | null) => void
  isDropOver?: boolean
}) {
  const active = matchPrefix ? pathname.startsWith(matchPrefix) : false
  return (
    <Box
      component={Link}
      href={href}
      ref={dropRef}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.75,
        borderRadius: 0.75,
        textDecoration: 'none',
        color: active ? 'text.primary' : muted ? 'text.disabled' : 'text.secondary',
        backgroundColor: isDropOver ? 'action.hover' : active ? 'action.selected' : 'transparent',
        outline: isDropOver ? '2px dashed' : 'none',
        outlineColor: 'primary.main',
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
