# Sidebar Collapse/Hover Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-state sidebar (open/collapsed/hidden) with a two-state model (open/hidden) plus a hover popover for quick access when hidden.

**Architecture:** Remove all collapsed (56px icon-only) logic from every sidebar component. When hidden, the sidebar is fully removed from the grid layout (0px). A `MenuIcon` in the toolbar allows reopening and shows a hover `Popper` with the full sidebar content overlaying main content.

**Tech Stack:** React 19, MUI v6 (Popper, Paper), Next.js App Router, localStorage for persistence.

---

## File Map

| Action | File                                                            | Responsibility                                                                      |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Modify | `packages/ui/src/components/index.ts`                           | Add `KeyboardDoubleArrowLeftIcon`, `MenuIcon`, `Popper`, `Paper` exports            |
| Modify | `apps/web/src/components/workspace/workspace-sidebar.tsx`       | Remove collapsed logic, use `KeyboardDoubleArrowLeftIcon`, always render full width |
| Modify | `apps/web/src/components/workspace/search-sidebar-section.tsx`  | Remove `collapsed` prop and collapsed-mode branch                                   |
| Modify | `apps/web/src/components/workspace/workspace-user-menu.tsx`     | Remove `collapsed` prop and collapsed-mode rendering                                |
| Modify | `apps/web/src/components/workspace/workspace-toolbar.tsx`       | Add `MenuIcon` with click-to-open and hover-to-popover behavior                     |
| Modify | `apps/web/src/components/workspace/workspace-shell.tsx`         | Replace `sidebarWidth` prop with `sidebarHidden` boolean                            |
| Modify | `apps/web/src/components/workspace/workspace-layout-client.tsx` | Orchestrate new two-state model, wire props                                         |

---

### Task 1: Export new MUI components from `@repo/ui`

**Files:**

- Modify: `packages/ui/src/components/index.ts:59-72` (icon exports block)

- [ ] **Step 1: Add icon and component exports**

Add these lines at the end of the icons block (after the `ArrowDropUpIcon` line, before the `export * from "./ui/button"` line) in `packages/ui/src/components/index.ts`:

```typescript
export { default as KeyboardDoubleArrowLeftIcon } from '@mui/icons-material/KeyboardDoubleArrowLeft'
export { default as MenuIcon } from '@mui/icons-material/Menu'
```

Add these lines in the MUI component exports section (after the `InputAdornment` export, before the icons):

```typescript
export { default as Popper, type PopperProps } from '@mui/material/Popper'
```

- [ ] **Step 2: Verify build**

Run: `pnpm build --filter=@repo/ui`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): export KeyboardDoubleArrowLeftIcon, MenuIcon, Popper"
```

---

### Task 2: Remove collapsed logic from `SearchSidebarSection`

**Files:**

- Modify: `apps/web/src/components/workspace/search-sidebar-section.tsx:31,196-226`

- [ ] **Step 1: Update Props type**

In `search-sidebar-section.tsx`, change line 31:

```typescript
// Before
type Props = { workspaceId: string; collapsed: boolean }

// After
type Props = { workspaceId: string }
```

- [ ] **Step 2: Remove `collapsed` from destructuring and delete collapsed branch**

In `SearchSidebarSection` function signature (line 196), remove `collapsed`:

```typescript
// Before
export function SearchSidebarSection({ workspaceId, collapsed }: Props) {

// After
export function SearchSidebarSection({ workspaceId }: Props) {
```

Delete the entire collapsed early-return block (lines 208-226):

```typescript
// DELETE this entire block:
  if (collapsed) {
    return (
      <Tooltip title="Поиск" placement="right">
        <Link href={`/workspaces/${workspaceId}/search`} style={{ textDecoration: "none" }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              py: 0.75,
              color: "text.secondary",
              "&:hover": { color: "text.primary" },
            }}
          >
            <SearchIcon sx={{ fontSize: 18 }} />
          </Box>
        </Link>
      </Tooltip>
    )
  }
```

- [ ] **Step 3: Remove unused `Tooltip` import if no longer used**

Check if `Tooltip` is still used elsewhere in the file. It is not (only `ChatListItem` uses it nowhere, and the collapsed branch was the only usage). Remove `Tooltip` from the import:

```typescript
// Before
import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  Button,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  DriveFileRenameOutlineIcon,
  Menu,
  MenuItem,
  MoreHorizIcon,
  SearchIcon,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@repo/ui/components'

// After
import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  Button,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  DriveFileRenameOutlineIcon,
  Menu,
  MenuItem,
  MoreHorizIcon,
  SearchIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
```

Also remove unused `Link` import from `next/link` — check first: `Link` is still used in `ChatListItem` (line 76), so **keep it**.

- [ ] **Step 4: Verify types**

Run: `pnpm check-types --filter=web`
Expected: Type errors in `workspace-sidebar.tsx` where `collapsed` is still passed. That is expected — we fix it in Task 4.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/search-sidebar-section.tsx
git commit -m "refactor: remove collapsed mode from SearchSidebarSection"
```

---

### Task 3: Remove collapsed logic from `WorkspaceUserMenu`

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-user-menu.tsx`

- [ ] **Step 1: Remove `collapsed` from Props and component**

```typescript
// Before (line 17-20)
type Props = {
  user: { firstName: string; lastName: string; email: string }
  collapsed: boolean
}

// After
type Props = {
  user: { firstName: string; lastName: string; email: string }
}
```

```typescript
// Before (line 22)
export function WorkspaceUserMenu({ user, collapsed }: Props) {

// After
export function WorkspaceUserMenu({ user }: Props) {
```

- [ ] **Step 2: Remove collapsed conditional rendering**

In the `Box` sx prop (line 37), remove the `justifyContent` conditional:

```typescript
// Before
justifyContent: collapsed ? "center" : "flex-start",

// After
justifyContent: "flex-start",
```

Remove the collapsed conditional around the name/email block (lines 51-59):

```typescript
// Before
{collapsed ? null : (
  <Stack spacing={0} sx={{ minWidth: 0 }}>
    <Typography variant="body2" noWrap>
      {user.firstName} {user.lastName}
    </Typography>
    <Typography variant="caption" color="text.secondary" noWrap>
      {user.email}
    </Typography>
  </Stack>
)}

// After
<Stack spacing={0} sx={{ minWidth: 0 }}>
  <Typography variant="body2" noWrap>
    {user.firstName} {user.lastName}
  </Typography>
  <Typography variant="caption" color="text.secondary" noWrap>
    {user.email}
  </Typography>
</Stack>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/workspace-user-menu.tsx
git commit -m "refactor: remove collapsed mode from WorkspaceUserMenu"
```

---

### Task 4: Rewrite `WorkspaceSidebar` — remove collapsed, add `onHide`

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Update imports — replace chevron icons with double-arrow**

```typescript
// Before
import {
  Box,
  ChevronLeftIcon,
  ChevronRightIcon,
  DeleteIcon,
  IconButton,
  SettingsIcon,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

// After
import {
  Box,
  DeleteIcon,
  IconButton,
  KeyboardDoubleArrowLeftIcon,
  SettingsIcon,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'
```

- [ ] **Step 2: Update Props type**

```typescript
// Before
type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: Array<{ id: string; title: string | null; icon: string | null }>
  collapsed: boolean
  onToggleCollapsed: () => void
  userMenu: ReactNode
}

// After
type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: Array<{ id: string; title: string | null; icon: string | null }>
  onHide: () => void
  userMenu: ReactNode
}
```

- [ ] **Step 3: Rewrite `WorkspaceSidebar` body**

Replace the entire function body. Key changes: remove all `collapsed` conditionals, always render full width 240px, use `KeyboardDoubleArrowLeftIcon`:

```tsx
export function WorkspaceSidebar({ workspace, planName, pages, onHide, userMenu }: Props) {
  return (
    <Box
      component="aside"
      sx={{
        width: 240,
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        px: 1.25,
        py: 1.75,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, pb: 1.75 }}>
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
          {workspace.icon ?? '\ud83d\udcd2'}
        </Box>
        <Stack spacing={0} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {workspace.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {planName} plan
          </Typography>
        </Stack>
        <Tooltip title="Скрыть" placement="right">
          <IconButton size="small" onClick={onHide} sx={{ flexShrink: 0 }}>
            <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack spacing={0.25} sx={{ py: 0.75 }}>
        <SearchSidebarSection workspaceId={workspace.id} />
        <NavItem
          icon={<SettingsIcon sx={{ fontSize: 16 }} />}
          label="Настройки"
          href={`/workspaces/${workspace.id}/settings`}
          matchPrefix={`/workspaces/${workspace.id}/settings`}
        />
      </Stack>

      <Typography
        variant="overline"
        sx={{ color: 'text.disabled', px: 1, pt: 2, pb: 0.5, letterSpacing: '0.06em' }}
      >
        Страницы
      </Typography>
      <Stack spacing={0.25}>
        {pages.map((page) => (
          <NavItem
            key={page.id}
            icon={<span style={{ fontSize: 14 }}>{page.icon ?? '\ud83d\udcc4'}</span>}
            label={page.title ?? 'Untitled'}
            href={`/workspaces/${workspace.id}`}
          />
        ))}
        <NavItem
          icon={<span style={{ fontSize: 14 }}>\uff0b</span>}
          label="Новая страница"
          href="#"
          muted
        />
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
        <NavItem
          icon={<DeleteIcon sx={{ fontSize: 16 }} />}
          label="Корзина"
          href="#"
          matchPrefix="/trash"
          muted
        />
      </Box>

      <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>{userMenu}</Box>
    </Box>
  )
}
```

- [ ] **Step 4: Simplify `NavItem` — remove collapsed prop**

Replace the entire `NavItem` function:

```tsx
function NavItem({
  icon,
  label,
  href,
  matchPrefix,
  muted,
}: {
  icon: ReactNode
  label: string
  href: string
  matchPrefix?: string
  muted?: boolean
}) {
  const pathname = usePathname()
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
      <span>{label}</span>
    </Box>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "refactor: remove collapsed mode from WorkspaceSidebar, use KeyboardDoubleArrowLeftIcon"
```

---

### Task 5: Update `WorkspaceShell` — boolean prop instead of width

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-shell.tsx`

- [ ] **Step 1: Replace the entire component**

```tsx
'use client'

import type { ReactNode } from 'react'

import { Box } from '@repo/ui/components'

type Props = {
  sidebar: ReactNode
  main: ReactNode
  sidebarHidden: boolean
}

export function WorkspaceShell({ sidebar, main, sidebarHidden }: Props) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: sidebarHidden ? '1fr' : '240px minmax(0, 1fr)',
        height: '100vh',
        bgcolor: 'background.default',
        color: 'text.primary',
        overflow: 'hidden',
        transition: 'grid-template-columns 150ms ease',
      }}
    >
      {sidebarHidden ? null : sidebar}
      <Box component="main" sx={{ overflow: 'auto' }}>
        {main}
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/workspace/workspace-shell.tsx
git commit -m "refactor: WorkspaceShell uses sidebarHidden boolean instead of width"
```

---

### Task 6: Update `WorkspaceToolbar` — add `MenuIcon` + hover Popper

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-toolbar.tsx`

- [ ] **Step 1: Rewrite the component**

This is the most complex change. The toolbar gains: a `MenuIcon` button (visible when sidebar is hidden), click handler to reopen sidebar, and hover behavior to show a `Popper` with the sidebar content overlaying main content.

Replace the entire file:

```tsx
'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'

import { Box, IconButton, MenuIcon, Paper, Popper, Stack, Typography } from '@repo/ui/components'

type Breadcrumb = { label: string; href?: string }

type Props = {
  breadcrumbs: Breadcrumb[]
  sidebarHidden: boolean
  onOpenSidebar: () => void
  sidebarContent: ReactNode
}

export function WorkspaceToolbar({
  breadcrumbs,
  sidebarHidden,
  onOpenSidebar,
  sidebarContent,
}: Props) {
  const [popperOpen, setPopperOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setPopperOpen(false), 120)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const handleMouseEnter = useCallback(() => {
    cancelClose()
    setPopperOpen(true)
  }, [cancelClose])

  const handleMouseLeave = useCallback(() => {
    scheduleClose()
  }, [scheduleClose])

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      sx={{
        px: 2,
        py: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {sidebarHidden ? (
        <Box onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <IconButton
            ref={anchorRef}
            size="small"
            onClick={onOpenSidebar}
            sx={{ color: 'text.secondary' }}
          >
            <MenuIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <Popper
            open={popperOpen}
            anchorEl={anchorRef.current}
            placement="bottom-start"
            sx={{ zIndex: 1300 }}
          >
            <Paper
              elevation={8}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              sx={{
                width: 240,
                maxHeight: 'calc(100vh - 80px)',
                overflow: 'auto',
                borderRadius: 2,
                mt: 0.5,
              }}
            >
              {sidebarContent}
            </Paper>
          </Popper>
        </Box>
      ) : null}
      {breadcrumbs.map((crumb, i) => (
        <Stack key={i} direction="row" alignItems="center" spacing={1.25}>
          {i > 0 && (
            <Typography variant="body2" color="text.disabled">
              /
            </Typography>
          )}
          <Typography
            variant="body2"
            noWrap
            color={i === breadcrumbs.length - 1 ? 'text.primary' : 'text.secondary'}
          >
            {crumb.label}
          </Typography>
        </Stack>
      ))}
      <Box sx={{ flex: 1 }} />
    </Stack>
  )
}
```

Key implementation notes:

- The `Box` wrapping `IconButton` + `Popper` forms the hover zone for the MenuIcon side
- The `Paper` inside Popper has its own `onMouseEnter`/`onMouseLeave` to keep the popper alive when the mouse moves into it
- A 120ms delay on close handles the gap between the icon and the popper
- `"use client"` is added because the component now uses hooks

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/workspace/workspace-toolbar.tsx
git commit -m "feat: WorkspaceToolbar MenuIcon with hover Popper for hidden sidebar"
```

---

### Task 7: Wire everything in `WorkspaceLayoutClient`

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`

- [ ] **Step 1: Rewrite the component to use the new two-state model**

Replace the entire file:

```tsx
'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { WorkspaceShell } from './workspace-shell'
import { WorkspaceSidebar } from './workspace-sidebar'
import { WorkspaceToolbar } from './workspace-toolbar'
import { WorkspaceUserMenu } from './workspace-user-menu'

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: Array<{ id: string; title: string | null; icon: string | null }>
  user: { firstName: string; lastName: string; email: string }
  children: ReactNode
}

const STORAGE_KEY = 'workspace.sidebar.collapsed'

export function WorkspaceLayoutClient({ workspace, planName, pages, user, children }: Props) {
  const [hidden, setHidden] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') setHidden(true)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(hidden))
  }, [hidden])

  const chatIdMatch = pathname.match(/\/search\/([a-f0-9-]{36})$/)
  const activeChatId = chatIdMatch?.[1] ?? null

  const chats = trpc.search.listChats.useQuery(
    { workspaceId: workspace.id },
    { enabled: activeChatId !== null },
  )
  const activeChat = activeChatId ? (chats.data?.find((c) => c.id === activeChatId) ?? null) : null

  const breadcrumbs = useMemo(() => {
    if (pathname.includes('/search')) {
      const base = { label: 'Поиск', href: `/workspaces/${workspace.id}/search` }
      if (activeChat) return [base, { label: activeChat.title ?? 'Без названия' }]
      return [base]
    }
    if (pathname.includes('/settings')) {
      return [{ label: 'Настройки' }]
    }
    if (pathname.includes('/trash')) {
      return [{ label: 'Корзина' }]
    }
    const pageIdMatch = pathname.match(/\/pages\/([a-f0-9-]{36})/)
    if (pageIdMatch) {
      const page = pages.find((p) => p.id === pageIdMatch[1])
      const base = { label: 'Страницы' }
      if (page) return [base, { label: page.title ?? 'Untitled' }]
      return [base]
    }
    return [{ label: workspace.name }]
  }, [pathname, activeChat, pages, workspace.id, workspace.name])

  const userMenu = <WorkspaceUserMenu user={user} />

  const sidebarNode = (
    <WorkspaceSidebar
      workspace={workspace}
      planName={planName}
      pages={pages}
      onHide={() => setHidden(true)}
      userMenu={userMenu}
    />
  )

  return (
    <WorkspaceShell
      sidebarHidden={hidden}
      sidebar={sidebarNode}
      main={
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          <WorkspaceToolbar
            breadcrumbs={breadcrumbs}
            sidebarHidden={hidden}
            onOpenSidebar={() => setHidden(false)}
            sidebarContent={sidebarNode}
          />
          <Box sx={{ flex: 1, overflow: 'auto' }}>{children}</Box>
        </Box>
      }
    />
  )
}
```

Key changes:

- `collapsed` renamed to `hidden`
- `sidebarWidth` removed — `WorkspaceShell` now takes `sidebarHidden: boolean`
- `sidebarNode` built once and passed to both `WorkspaceShell` (grid sidebar) and `WorkspaceToolbar` (popper content)
- `WorkspaceUserMenu` no longer receives `collapsed`
- `WorkspaceSidebar` receives `onHide` instead of `onToggleCollapsed`

- [ ] **Step 2: Verify types**

Run: `pnpm check-types --filter=web`
Expected: PASS — all components now have matching props.

- [ ] **Step 3: Verify lint**

Run: `pnpm lint --filter=web`
Expected: PASS with no warnings.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workspace/workspace-layout-client.tsx
git commit -m "feat: wire two-state sidebar model in WorkspaceLayoutClient"
```

---

### Task 8: Visual verification

- [ ] **Step 1: Start dev server**

Run: `pnpm dev --filter=web`

- [ ] **Step 2: Test open state**

Open `http://localhost:3000`, sign in, navigate to a workspace. Verify:

- Sidebar shows at 240px with full content
- `KeyboardDoubleArrowLeftIcon` (double chevron «) is visible in sidebar header
- All nav items, pages, search section, user menu render normally

- [ ] **Step 3: Test hide action**

Click the `«` icon. Verify:

- Sidebar disappears completely (0px, no border visible)
- Main content expands to full width
- `MenuIcon` (hamburger) appears in the toolbar before breadcrumbs

- [ ] **Step 4: Test hover popover**

Hover over the `MenuIcon`. Verify:

- Popper appears below the icon, overlaying main content
- Popper contains the same sidebar content (workspace name, search, settings, pages, trash, user menu)
- Moving mouse from icon into popper keeps it open
- Moving mouse outside popper closes it

- [ ] **Step 5: Test reopen**

Click the `MenuIcon`. Verify:

- Sidebar reappears at 240px
- `MenuIcon` disappears from toolbar

- [ ] **Step 6: Test persistence**

Hide the sidebar, refresh the page. Verify sidebar stays hidden. Reopen, refresh — stays open.

- [ ] **Step 7: Final commit**

If any fixes were needed during testing, commit them:

```bash
git add -u
git commit -m "fix: sidebar collapse visual adjustments"
```
