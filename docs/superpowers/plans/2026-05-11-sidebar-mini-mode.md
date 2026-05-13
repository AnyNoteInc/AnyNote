# Sidebar mini mode + reshuffle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default the workspace sidebar to a 56px icon-only "mini" mode and reshuffle Trash (into Pages header) and Notifications (into the user menu).

**Architecture:** Replace the binary `hidden` boolean with `mode: 'mini' | 'full'` persisted in localStorage. Introduce a new `WorkspaceSidebarMini` component, slim down `WorkspaceSidebar` (full), and reshape `WorkspaceUserMenu` + `PageTreeSection` to host the relocated items. `WorkspaceShell` swaps grid columns by mode; `WorkspaceToolbar` loses its now-obsolete sidebar props.

**Tech Stack:** Next.js App Router (client components), React 19, MUI v6 via `@repo/ui/components`, tRPC v11 (`trpc.notification.unreadCount`), Playwright for E2E.

**Reference spec:** `docs/superpowers/specs/2026-05-11-sidebar-mini-mode-design.md`

---

## File structure

**Create:**

- `apps/web/src/components/workspace/workspace-sidebar-mini.tsx` — 56px icon column with workspace icon, expand, search, chats, settings, trash, user avatar.

**Modify:**

- `apps/web/src/components/workspace/workspace-user-menu.tsx` — add Notifications menu item + popover; add `variant: 'default' | 'compact'`.
- `apps/web/src/components/workspace/page-tree-section.tsx` — add Trash icon after the `+` button in the Pages header.
- `apps/web/src/components/workspace/workspace-sidebar.tsx` — remove bottom Trash & Notifications blocks; rename `onHide` → `onCollapse`, tooltip "Свернуть".
- `apps/web/src/components/workspace/workspace-shell.tsx` — `sidebarHidden: boolean` → `mode: SidebarMode`; grid columns switch on mode.
- `apps/web/src/components/workspace/workspace-layout-client.tsx` — `hidden` state → `mode` state, persist under new key, mount mini vs full.
- `apps/web/src/components/workspace/workspace-toolbar.tsx` — drop `sidebarHidden`, `onOpenSidebar`, `sidebarContent` props and the MenuIcon + Popper logic.
- `apps/e2e/workspace-flow.spec.ts` — update assertions that depended on the full sidebar being default.

**Delete:**

- `apps/web/src/components/notifications/sidebar-notifications-trigger.tsx` — replaced by user-menu item.

**Add:**

- `apps/e2e/sidebar-mini-mode.spec.ts` — covers default mini, toggle to full + persistence, trash icon in pages header, notifications in user menu.

---

## Task 1: Add Notifications item + popover to user menu

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-user-menu.tsx`

Add the unread query, a Notifications menu item between Профиль and Настройки, and a separate Popover that hosts `NotificationsPopoverCard`. Clicking the menu item closes the user menu and re-anchors the popover to the original avatar element.

- [ ] **Step 1.1: Replace the imports block at the top of `workspace-user-menu.tsx`**

Open `apps/web/src/components/workspace/workspace-user-menu.tsx` and replace the existing imports (lines 6-32) with:

```tsx
import {
  ArrowCircleUpIcon,
  Avatar,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Chip,
  DarkModeRoundedIcon,
  Divider,
  DevicesRoundedIcon,
  LightModeRoundedIcon,
  ListItemIcon,
  ListItemText,
  LogoutIcon,
  Menu,
  MenuItem,
  NotificationsIcon,
  PersonIcon,
  Popover,
  SettingsIcon,
  Stack,
  Typography,
} from '@repo/ui/components'
import { useThemeMode } from '@repo/ui/providers'

import type { PlanFeatures } from '@repo/trpc'

import { getPlanDisplayName } from '@/components/billing/plan-labels'
import { NotificationsPopoverCard } from '@/components/notifications/notifications-popover-card'
import { trpc } from '@/trpc/client'
```

- [ ] **Step 1.2: Add notification state inside `WorkspaceUserMenu`**

In the same file, locate `export function WorkspaceUserMenu({ user, features }: Props) {` and immediately after the existing `const [anchor, setAnchor] = useState<HTMLElement | null>(null)` add:

```tsx
const [notifAnchor, setNotifAnchor] = useState<HTMLElement | null>(null)
const unread = trpc.notification.unreadCount.useQuery(undefined, { refetchInterval: 30_000 })
const closeNotif = () => setNotifAnchor(null)
const openNotifications = () => {
  setNotifAnchor(anchor)
  setAnchor(null)
}
```

- [ ] **Step 1.3: Insert the Notifications menu item between Профиль and Настройки**

In the same file, find the existing block:

```tsx
<MenuItem component={Link} href="/profile" onClick={close}>
  <ListItemIcon>
    <PersonIcon fontSize="small" />
  </ListItemIcon>
  <ListItemText>Профиль</ListItemText>
</MenuItem>
<MenuItem component={Link} href="/settings" onClick={close}>
```

Insert a new MenuItem between them:

```tsx
<MenuItem component={Link} href="/profile" onClick={close}>
  <ListItemIcon>
    <PersonIcon fontSize="small" />
  </ListItemIcon>
  <ListItemText>Профиль</ListItemText>
</MenuItem>
<MenuItem onClick={openNotifications}>
  <ListItemIcon>
    <Badge badgeContent={unread.data ?? 0} max={99} color="error">
      <NotificationsIcon fontSize="small" />
    </Badge>
  </ListItemIcon>
  <ListItemText>Уведомления</ListItemText>
</MenuItem>
<MenuItem component={Link} href="/settings" onClick={close}>
```

- [ ] **Step 1.4: Add the Notifications popover after the closing `</Menu>`**

In the same file, find the closing `</Menu>` tag (currently the last child of the top-level fragment). Add a `Popover` immediately after it, before the closing `</>`:

```tsx
      </Menu>
      <Popover
        open={!!notifAnchor}
        anchorEl={notifAnchor}
        onClose={closeNotif}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <NotificationsPopoverCard onNavigate={closeNotif} />
      </Popover>
    </>
  )
}
```

- [ ] **Step 1.5: Sanity check via type checker**

Run from repo root:

```bash
pnpm --filter web check-types
```

Expected: passes with no new errors in `workspace-user-menu.tsx`.

- [ ] **Step 1.6: Commit**

```bash
git add apps/web/src/components/workspace/workspace-user-menu.tsx
git commit -m "feat(web): add notifications popover entry to workspace user menu"
```

---

## Task 2: Trash icon in Pages section header

**Files:**

- Modify: `apps/web/src/components/workspace/page-tree-section.tsx`

Add a Trash `IconButton` immediately after the `+` button in the "Страницы" header row. It is a navigational link to `/workspaces/{id}/trash` with a tooltip.

- [ ] **Step 2.1: Add the imports**

Open `apps/web/src/components/workspace/page-tree-section.tsx`. In the existing import from `@repo/ui/components` (lines 6-22) add `DeleteIcon` and `Tooltip`:

```tsx
import {
  AccountTreeIcon,
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  BrushIcon,
  ChevronRightIcon,
  DeleteIcon,
  DescriptionIcon,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreHorizIcon,
  Tooltip,
  Typography,
  AddIcon,
} from '@repo/ui/components'
```

- [ ] **Step 2.2: Insert the Trash icon button right after the `+` button in the section header**

In the same file, find the section header `IconButton` for create (the one wrapping `<AddIcon ...>`) inside `PageTreeSection`. After `</CreatePageMenu>` but still inside the outer `<Box>` that holds the header row, insert:

```tsx
<Tooltip title="Корзина" placement="top">
  <IconButton
    size="small"
    component={Link}
    href={`/workspaces/${workspaceId}/trash`}
    aria-label="Корзина"
    sx={{ p: 0.25 }}
  >
    <DeleteIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
  </IconButton>
</Tooltip>
```

The final order in the header row is: clickable label-and-caret → `+` IconButton → CreatePageMenu → new Trash IconButton.

- [ ] **Step 2.3: Sanity check via type checker**

```bash
pnpm --filter web check-types
```

Expected: passes.

- [ ] **Step 2.4: Commit**

```bash
git add apps/web/src/components/workspace/page-tree-section.tsx
git commit -m "feat(web): add trash shortcut next to + in pages sidebar header"
```

---

## Task 3: Full sidebar — remove bottom Trash & Notifications, rename onHide → onCollapse

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

After tasks 1 and 2, Trash is reachable from the Pages header and Notifications from the user menu, so the bottom blocks are redundant. Rename `onHide` to `onCollapse` and update the tooltip to "Свернуть" so the meaning matches the new state model.

- [ ] **Step 3.1: Drop unused imports**

In `apps/web/src/components/workspace/workspace-sidebar.tsx` lines 8-20, remove `DeleteIcon` from the `@repo/ui/components` import. Also remove the import at line 33:

```tsx
import { SidebarNotificationsTrigger } from '../notifications/sidebar-notifications-trigger'
```

Result of the imports block:

```tsx
import {
  ArrowDropDownIcon,
  Box,
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

import { isMac } from '@/lib/platform'
import { trpc } from '@/trpc/client'

import { FavoritesSection } from './favorites-section'
import { PageTreeSection } from './page-tree-section'
import type { PageItem } from './types'
import { SearchSidebarSection } from './search-sidebar-section'
import { SIDEBAR_WIDTH } from './workspace-layout-client'
import { SidebarSearchTrigger } from '../search/sidebar-search-trigger'
```

- [ ] **Step 3.2: Rename `onHide` to `onCollapse` in the props type**

In the same file, change the `Props` type:

```tsx
type Props = {
  workspace: { id: string; name: string; icon: string | null }
  features: PlanFeatures
  pages: PageItem[]
  onCollapse?: () => void
  userMenu: ReactNode
}
```

Update the destructured parameter:

```tsx
export function WorkspaceSidebar({ workspace, features, pages, onCollapse, userMenu }: Props) {
```

- [ ] **Step 3.3: Update the collapse button tooltip + handler**

Find the existing block:

```tsx
{
  onHide ? (
    <Tooltip title="Скрыть" placement="right">
      <IconButton size="small" onClick={onHide} sx={{ flexShrink: 0 }}>
        <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  ) : null
}
```

Replace with:

```tsx
{
  onCollapse ? (
    <Tooltip title="Свернуть" placement="right">
      <IconButton size="small" onClick={onCollapse} aria-label="Свернуть" sx={{ flexShrink: 0 }}>
        <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  ) : null
}
```

- [ ] **Step 3.4: Delete the bottom Trash and Notifications blocks**

In the same file, delete these three blocks (they currently sit between `<Box sx={{ flex: 1 }} />` and the user-menu `<Box>`):

```tsx
<Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
  <NavItem
    icon={<DeleteIcon sx={{ fontSize: 16 }} />}
    label="Корзина"
    href={`/workspaces/${workspace.id}/trash`}
    matchPrefix={`/workspaces/${workspace.id}/trash`}
    pathname={pathname}
  />
</Box>

<Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
  <SidebarNotificationsTrigger />
</Box>

<Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>{userMenu}</Box>
```

Replace them with just:

```tsx
<Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>{userMenu}</Box>
```

- [ ] **Step 3.5: Sanity check**

```bash
pnpm --filter web check-types
```

Expected: passes. (`workspace-layout-client.tsx` still passes `onHide={...}` so we may see one error there — that's expected and will be fixed in Task 6. If you want a clean intermediate state, also do step 3.6 below before committing.)

- [ ] **Step 3.6: Update the call site to keep the build green**

`apps/web/src/components/workspace/workspace-layout-client.tsx` currently does:

```tsx
sidebar={<WorkspaceSidebar {...sidebarProps} onHide={() => setHidden(true)} />}
```

Change `onHide` to `onCollapse` at the call site (we'll rewrite the full state model in Task 6 — for now we just preserve the name):

```tsx
sidebar={<WorkspaceSidebar {...sidebarProps} onCollapse={() => setHidden(true)} />}
```

- [ ] **Step 3.7: Run types again**

```bash
pnpm --filter web check-types
```

Expected: passes.

- [ ] **Step 3.8: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx \
        apps/web/src/components/workspace/workspace-layout-client.tsx
git commit -m "refactor(web): drop bottom trash/notifications, rename onHide→onCollapse"
```

---

## Task 4: User menu compact variant

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-user-menu.tsx`

The mini sidebar needs to render only the avatar (no name + plan chip). Add a `variant` prop and branch on it.

- [ ] **Step 4.1: Extend `Props` and accept the new prop**

In `apps/web/src/components/workspace/workspace-user-menu.tsx`, update the `Props` type:

```tsx
type Props = {
  user: { firstName: string; lastName: string; email: string; image: string | null }
  features: PlanFeatures
  variant?: 'default' | 'compact'
}
```

And the function signature:

```tsx
export function WorkspaceUserMenu({ user, features, variant = 'default' }: Props) {
```

- [ ] **Step 4.2: Branch the trigger layout on `variant`**

Find the existing `<Box>` that opens the menu (currently `<Box onClick={(event) => setAnchor(event.currentTarget)} sx={{...}}>...<Avatar/>...<Stack>...name/plan...</Stack></Box>`). Replace the entire block (from that opening `<Box>` up to its matching `</Box>` that contains the Stack with name and plan chip) with:

```tsx
{
  variant === 'compact' ? (
    <Box
      onClick={(event) => setAnchor(event.currentTarget)}
      role="button"
      aria-label={`Меню пользователя ${user.firstName} ${user.lastName}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
        borderRadius: 0.75,
        cursor: 'pointer',
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
    </Box>
  ) : (
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
  )
}
```

The `<Menu>` and `<Popover>` that follow remain unchanged — they re-use `anchor` / `notifAnchor` and work for both layouts.

- [ ] **Step 4.3: Sanity check**

```bash
pnpm --filter web check-types
```

Expected: passes.

- [ ] **Step 4.4: Commit**

```bash
git add apps/web/src/components/workspace/workspace-user-menu.tsx
git commit -m "feat(web): add compact variant to WorkspaceUserMenu"
```

---

## Task 5: Create the mini sidebar component

**Files:**

- Create: `apps/web/src/components/workspace/workspace-sidebar-mini.tsx`

A 56px-wide icon column with workspace icon (with switcher), expand button, search, chats (conditional), settings, trash, spacer, user avatar (compact menu).

- [ ] **Step 5.1: Create the file with full content**

Create `apps/web/src/components/workspace/workspace-sidebar-mini.tsx`:

```tsx
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
      <Tooltip title={hasMultiple ? 'Сменить пространство' : workspace.name} placement="right">
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
        <IconButton size="small" onClick={openSearch} aria-label="Поиск" sx={iconButtonSx(false)}>
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

      <Stack
        alignItems="center"
        sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider', width: '100%' }}
      >
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
```

- [ ] **Step 5.2: Make sure UI re-exports cover the new icons**

The mini sidebar references `KeyboardDoubleArrowRightIcon` and `ChatBubbleOutlineIcon`. Verify they're already re-exported from `@repo/ui/components`:

```bash
grep -E "KeyboardDoubleArrowRightIcon|ChatBubbleOutlineIcon" packages/ui/src/components/index.ts
```

Expected: both are listed. (They are — `KeyboardDoubleArrowLeftIcon`/`Right` are in MUI, but our re-export may only list Left.) If `KeyboardDoubleArrowRightIcon` is missing from the index, add it in the same alphabetical block:

```ts
export { default as KeyboardDoubleArrowRightIcon } from '@mui/icons-material/KeyboardDoubleArrowRight'
```

If `ChatBubbleOutlineIcon` is missing similarly, add:

```ts
export { default as ChatBubbleOutlineIcon } from '@mui/icons-material/ChatBubbleOutline'
```

- [ ] **Step 5.3: Sanity check**

```bash
pnpm --filter web check-types
```

Expected: passes. (The component is not yet rendered anywhere — wiring happens in Task 6.)

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar-mini.tsx \
        packages/ui/src/components/index.ts
git commit -m "feat(web): add WorkspaceSidebarMini icon column"
```

---

## Task 6: Wire `mode: 'mini' | 'full'` through shell, layout client, and toolbar

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-shell.tsx`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`
- Modify: `apps/web/src/components/workspace/workspace-toolbar.tsx`

This is a single coordinated edit — the three files share the contract. We commit them together so the app is never broken between commits.

- [ ] **Step 6.1: Update `workspace-shell.tsx`**

Replace the entire body of `apps/web/src/components/workspace/workspace-shell.tsx` with:

```tsx
'use client'

import type { ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { SIDEBAR_MINI_WIDTH } from './workspace-sidebar-mini'
import { SIDEBAR_WIDTH } from './workspace-layout-client'

export type SidebarMode = 'mini' | 'full'

type Props = {
  sidebar: ReactNode
  main: ReactNode
  mode: SidebarMode
}

export function WorkspaceShell({ sidebar, main, mode }: Props) {
  const columns =
    mode === 'mini' ? `${SIDEBAR_MINI_WIDTH}px minmax(0, 1fr)` : `${SIDEBAR_WIDTH}px minmax(0, 1fr)`

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: columns,
        height: '100vh',
        bgcolor: 'background.default',
        color: 'text.primary',
        overflow: 'hidden',
        transition: 'grid-template-columns 150ms ease',
      }}
    >
      <Box className="workspace-sidebar" sx={{ height: '100%', minHeight: 0, display: 'flex' }}>
        {sidebar}
      </Box>
      <Box component="main" sx={{ overflow: 'auto' }}>
        {main}
      </Box>
    </Box>
  )
}
```

- [ ] **Step 6.2: Update `workspace-layout-client.tsx`**

Open `apps/web/src/components/workspace/workspace-layout-client.tsx` and apply these changes:

1. Add imports near the top:

```tsx
import { WorkspaceSidebarMini } from './workspace-sidebar-mini'
import type { SidebarMode } from './workspace-shell'
```

2. Replace the constants block:

```tsx
const STORAGE_KEY = 'workspace.sidebar.collapsed'
export const SIDEBAR_WIDTH = 313
```

with:

```tsx
const STORAGE_KEY = 'workspace.sidebar.mode'
const DEFAULT_MODE: SidebarMode = 'mini'
export const SIDEBAR_WIDTH = 313
```

3. Replace the state + effect block:

```tsx
const [hidden, setHidden] = useState(false)
...
useEffect(() => {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'true') setHidden(true)
}, [])

useEffect(() => {
  window.localStorage.setItem(STORAGE_KEY, String(hidden))
}, [hidden])
```

with:

```tsx
const [mode, setMode] = useState<SidebarMode>(DEFAULT_MODE)

useEffect(() => {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'mini' || stored === 'full') setMode(stored)
}, [])

useEffect(() => {
  window.localStorage.setItem(STORAGE_KEY, mode)
}, [mode])
```

4. Inside the existing `const mainContent = (...)` block, find the `<WorkspaceToolbar ... />` call and replace it with the slimmer version (drop `sidebarHidden`, `onOpenSidebar`, `sidebarContent`):

```tsx
<WorkspaceToolbar
  breadcrumbs={breadcrumbs}
  rightSlot={
    activePageId ? <PageActionsToolbar pageId={activePageId} workspaceId={workspace.id} /> : null
  }
/>
```

The surrounding `<Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>` wrapper and the children-rendering body below remain unchanged.

5. Replace the final return JSX (the `WorkspaceShell` usage) with:

```tsx
return (
  <SearchDialogProvider workspaceId={workspace.id}>
    <WorkspaceHotkeyMount workspaceId={workspace.id} />
    <WorkspaceShell
      mode={mode}
      sidebar={
        mode === 'mini' ? (
          <WorkspaceSidebarMini
            workspace={workspace}
            features={features}
            user={user}
            onExpand={() => setMode('full')}
          />
        ) : (
          <WorkspaceSidebar {...sidebarProps} onCollapse={() => setMode('mini')} />
        )
      }
      main={activePageId ? <PageEditorProvider>{mainContent}</PageEditorProvider> : mainContent}
    />
  </SearchDialogProvider>
)
```

6. The `sidebarProps` object can now drop `userMenu` because the full sidebar still needs it; double-check the definition just above. It must still be:

```tsx
const userMenu = <WorkspaceUserMenu user={user} features={features} />
const sidebarProps = { workspace, features, pages, userMenu }
```

(unchanged — leave as is).

- [ ] **Step 6.3: Update `workspace-toolbar.tsx`**

Replace the entire body of `apps/web/src/components/workspace/workspace-toolbar.tsx` with:

```tsx
'use client'

import Link from 'next/link'

import { Box, Stack, Typography } from '@repo/ui/components'

import type { ReactNode } from 'react'

type Breadcrumb = { label: string; href?: string }

type Props = {
  breadcrumbs: Breadcrumb[]
  rightSlot?: ReactNode
}

export function WorkspaceToolbar({ breadcrumbs, rightSlot }: Props) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      className="workspace-toolbar"
      sx={{
        px: 2,
        py: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {breadcrumbs.map((crumb, i) => {
        const isLast = i === breadcrumbs.length - 1
        return (
          <Stack key={i} direction="row" alignItems="center" spacing={1.25}>
            {i > 0 && (
              <Typography variant="body2" color="text.disabled">
                /
              </Typography>
            )}
            {crumb.href && !isLast ? (
              <Typography
                component={Link}
                href={crumb.href}
                variant="body2"
                noWrap
                sx={{
                  color: 'text.secondary',
                  textDecoration: 'none',
                  '&:hover': { color: 'text.primary', textDecoration: 'underline' },
                }}
              >
                {crumb.label}
              </Typography>
            ) : (
              <Typography variant="body2" noWrap color={isLast ? 'text.primary' : 'text.secondary'}>
                {crumb.label}
              </Typography>
            )}
          </Stack>
        )
      })}
      <Box sx={{ flex: 1 }} />
      {rightSlot}
    </Stack>
  )
}
```

- [ ] **Step 6.4: Run type checks + lint**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: both pass.

- [ ] **Step 6.5: Smoke-test in the browser**

In a separate terminal (Docker must be up):

```bash
docker compose up -d
pnpm --filter web dev
```

Open http://localhost:3000, sign in, navigate to any workspace. Expect:

- Sidebar comes up in mini (56px) mode by default.
- Clicking the `KeyboardDoubleArrowRightIcon` expands to full (313px).
- Clicking `KeyboardDoubleArrowLeftIcon` in full mode collapses to mini.
- The choice persists after a hard reload.
- In mini mode, hovering each icon shows the Russian tooltip; clicking Settings / Trash / Chats navigates correctly; Search opens the dialog.
- In full mode, the bottom Trash/Notifications blocks are gone; clicking the trash icon next to `+` in the Pages header navigates to `/trash`; clicking the avatar shows Профиль → Уведомления → Настройки and clicking Уведомления opens the popover.

If anything fails, stop and fix before committing.

- [ ] **Step 6.6: Commit**

```bash
git add apps/web/src/components/workspace/workspace-shell.tsx \
        apps/web/src/components/workspace/workspace-layout-client.tsx \
        apps/web/src/components/workspace/workspace-toolbar.tsx
git commit -m "feat(web): default workspace sidebar to mini, wire mode through shell"
```

---

## Task 7: Delete the unused `sidebar-notifications-trigger.tsx`

**Files:**

- Delete: `apps/web/src/components/notifications/sidebar-notifications-trigger.tsx`

The component is no longer imported anywhere. Removing it now keeps the tree tidy.

- [ ] **Step 7.1: Verify no remaining imports**

```bash
grep -r "sidebar-notifications-trigger\|SidebarNotificationsTrigger" apps packages 2>/dev/null \
  | grep -v node_modules \
  | grep -v "\.next"
```

Expected: no matches (other than the file itself).

- [ ] **Step 7.2: Delete the file**

```bash
git rm apps/web/src/components/notifications/sidebar-notifications-trigger.tsx
```

- [ ] **Step 7.3: Sanity check**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: both pass.

- [ ] **Step 7.4: Commit**

```bash
git commit -m "chore(web): drop unused sidebar-notifications-trigger"
```

---

## Task 8: E2E tests for new sidebar behavior + fix existing assertions

**Files:**

- Modify: `apps/e2e/workspace-flow.spec.ts`
- Create: `apps/e2e/sidebar-mini-mode.spec.ts`

Existing `workspace-flow.spec.ts` clicks `page.getByText('Тест Ревьюер', { exact: true })` to open the user menu — that text is hidden in mini. Fix it by expanding the sidebar before the assertion. Add a new spec covering all new behaviors.

- [ ] **Step 8.1: Update `workspace-flow.spec.ts`**

In `apps/e2e/workspace-flow.spec.ts`, find the block that runs after `await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)` in the "workspace + settings happy path" test:

```ts
await expect(page.getByRole('heading', { name: 'Добро пожаловать в AnyNote' })).toBeVisible()

await page.getByText('Тест Ревьюер', { exact: true }).click()
```

Insert an expand step before the user-name click:

```ts
await expect(page.getByRole('heading', { name: 'Добро пожаловать в AnyNote' })).toBeVisible()

await page.getByRole('button', { name: 'Развернуть' }).click()
await page.getByText('Тест Ревьюер', { exact: true }).click()
```

- [ ] **Step 8.2: Verify the existing test still passes**

```bash
pnpm exec playwright test apps/e2e/workspace-flow.spec.ts
```

Expected: PASS for both tests in the file.

- [ ] **Step 8.3: Create the new spec file**

Create `apps/e2e/sidebar-mini-mode.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function signInToWorkspace(page: import('@playwright/test').Page, slug: string) {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Юзер' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Пространство')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)
}

test('sidebar defaults to mini and persists across reload', async ({ page }) => {
  await signInToWorkspace(page, 'mini-default')

  await expect(page.getByRole('button', { name: 'Развернуть' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Свернуть' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await expect(page.getByRole('button', { name: 'Свернуть' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Свернуть' })).toBeVisible()

  await page.getByRole('button', { name: 'Свернуть' }).click()
  await expect(page.getByRole('button', { name: 'Развернуть' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Развернуть' })).toBeVisible()
})

test('trash shortcut in pages header navigates to trash', async ({ page }) => {
  await signInToWorkspace(page, 'trash-shortcut')

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await page.getByRole('link', { name: 'Корзина' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/trash$/)
})

test('notifications appear inside the user menu popover', async ({ page }) => {
  await signInToWorkspace(page, 'notif-menu')

  await page.getByRole('button', { name: /Меню пользователя/ }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Уведомления' })).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Уведомления' }).click()
  await expect(menu).toBeHidden()
  await expect(page.getByText(/уведомлен/i).first()).toBeVisible()
})
```

- [ ] **Step 8.4: Run the new spec**

```bash
pnpm exec playwright test apps/e2e/sidebar-mini-mode.spec.ts
```

Expected: all three tests PASS. If the "notifications popover" assertion fails because the empty-state copy uses a different word, inspect the actual UI (e.g. `await page.pause()` while developing) and replace the regex with a stable selector — for example targeting `NotificationsPopoverCard`'s heading via `getByRole('heading', { name: 'Уведомления' })`.

- [ ] **Step 8.5: Run the full E2E suite for regressions**

```bash
pnpm exec playwright test
```

Expected: previously green specs still pass.

- [ ] **Step 8.6: Commit**

```bash
git add apps/e2e/workspace-flow.spec.ts apps/e2e/sidebar-mini-mode.spec.ts
git commit -m "test(e2e): cover sidebar mini mode, trash shortcut, notifications in user menu"
```

---

## Final gate

- [ ] **Run `pnpm gates`**

```bash
pnpm gates
```

Expected: PASS (check-types + lint + build + test). If any sub-step fails, fix in place and re-run.

- [ ] **Cross-check against the spec**

Re-read `docs/superpowers/specs/2026-05-11-sidebar-mini-mode-design.md`. Confirm each section ("State model", "Components", "Interaction flows", "Testing") has a corresponding task in this plan. If anything is unimplemented, add it as an additional task before merging.

---

## Notes for the implementer

- Existing localStorage key `'workspace.sidebar.collapsed'` is intentionally not migrated. Users see mini by default after the change and can re-pin full with one click.
- The mini sidebar links use `IconButton component={Link}`. MUI emits a single `<a>` so Playwright `getByRole('link', { name })` matches; rely on `aria-label` so the accessible name is stable in both light/dark themes.
- The notifications popover is anchored to the user-menu avatar element (captured into `notifAnchor` at the moment the menu closes). Do not anchor it to the menu item — by then the Menu has unmounted and the ref is stale.
- `WorkspaceUserMenu` is mounted twice when both sidebars would be rendered. The shell only mounts one sidebar at a time, so the React tree never holds two simultaneous instances; the trpc unread query therefore fires once per shown sidebar.
