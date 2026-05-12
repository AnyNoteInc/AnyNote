# Sidebar mini mode + sidebar reshuffle — design

Date: 2026-05-11
Status: approved (brainstorm)

## Goals

- Default to a compact icon-only ("mini") sidebar on every workspace page so the
  main canvas gets more room out of the box. Users opt into the full sidebar
  when they want the page tree.
- Tidy the full sidebar by moving two items that don't belong as their own
  bottom sections:
  - **Trash** moves into the "Страницы" section header (icon next to `+`).
  - **Notifications** moves into the user menu (between Профиль and Настройки).

## Non-goals

- No changes to marketing / auth / profile / settings layouts. This is scoped to
  the workspace shell (`apps/web/src/components/workspace/*`).
- No new notifications surface. We keep `NotificationsPopoverCard` and the
  existing `trpc.notification.unreadCount` query.
- No redesign of the page-tree itself.

## State model

Today `workspace-layout-client.tsx` tracks a single `hidden: boolean` with two
states: visible (313px) and entirely hidden. It is replaced with:

```ts
type SidebarMode = 'mini' | 'full'
```

- Default: `'mini'`.
- Persisted in `localStorage` under a new key, `'workspace.sidebar.mode'`.
  The old `'workspace.sidebar.collapsed'` key is dropped (no migration —
  users get the new default once).
- The fully-hidden state is removed. Mini already keeps the canvas wide.

## Components

### `workspace-shell.tsx`

Prop change: `sidebarHidden: boolean` → `mode: SidebarMode`.

Grid columns:

- `mode === 'mini'` → `'56px minmax(0, 1fr)'`
- `mode === 'full'` → `'${SIDEBAR_WIDTH}px minmax(0, 1fr)'`

Both modes always render the sidebar slot — the parent decides which sidebar
component to mount.

### `workspace-layout-client.tsx`

- Replace `hidden` state with `mode` state (mini default).
- `useEffect` reads `'workspace.sidebar.mode'`; falls back to `'mini'`.
- `useEffect` writes the mode on change.
- Pass `mode` to `WorkspaceShell`. Mount `<WorkspaceSidebarMini />` when
  `mode === 'mini'`, otherwise `<WorkspaceSidebar onCollapse={() => setMode('mini')} />`.
- The toolbar no longer needs sidebar-related props; pass only breadcrumbs and
  `rightSlot`.
- `SIDEBAR_WIDTH` stays (313). A new constant `SIDEBAR_MINI_WIDTH = 56` lives
  next to it.

### `workspace-sidebar-mini.tsx` (new)

~56px wide vertical icon column with the same paper background / right border
as the full sidebar. Layout:

1. **Workspace icon** at top.
   - Click opens the workspace switcher menu (same `Menu` used in the full
     header) when `hasMultiple === true`.
   - Otherwise it's a non-interactive logo.
2. **Expand button** (`KeyboardDoubleArrowRightIcon`) — calls `onExpand` to set
   mode `'full'`. Tooltip "Развернуть".
3. **Search** icon — reuses the action behind `SidebarSearchTrigger` (open
   search dialog via the existing hook/provider). Tooltip "Поиск" with the
   `⌘K` / `Ctrl+K` shortcut.
4. **Chats** icon — only when `features.chatsEnabled`. Opens the same popover
   `SearchSidebarSection` opens today (factor into a small `useChatsPopover`
   hook, or move popover state into a shared trigger). Tooltip "Чаты".
5. **Settings** — `Link` to `/workspaces/{id}/settings`. Tooltip "Настройки"
   with shortcut.
6. **Trash** — `Link` to `/workspaces/{id}/trash`. Tooltip "Корзина".
7. `flex: 1` spacer.
8. **User avatar** — a compact variant of `WorkspaceUserMenu` that renders the
   avatar only (no name / plan chip) and opens the same user menu (including
   the new Notifications item).

All icon buttons share size (40px square, rounded 0.75, hover background
`action.hover`) so the column looks consistent. Active state highlight on
Settings/Trash mirrors the existing `NavItem` logic.

### `workspace-sidebar.tsx` (full)

Two removals + one button change:

- Delete the bottom **Корзина** block (the `<NavItem icon={<DeleteIcon …>}>`
  section) and the divider that introduces it.
- Delete the bottom **Notifications** block (`<SidebarNotificationsTrigger />`)
  and its divider.
- The `KeyboardDoubleArrowLeftIcon` button in the header now means "свернуть
  в mini". Rename the prop from `onHide` to `onCollapse` (just for clarity)
  and update the tooltip to "Свернуть".

After these edits the bottom of the sidebar is just the user menu sitting
above the (removed) divider stack; one divider remains above it.

### `page-tree-section.tsx`

In the "Страницы" header row (currently: label + dropdown caret + `+` button),
add a second `IconButton` immediately to the right of `+`:

- Icon: `DeleteIcon` at `fontSize: 16`, `color: 'text.secondary'`.
- Wrapped in `Tooltip title="Корзина"`.
- Wrapped in `Link href={\`/workspaces/${workspaceId}/trash\`}`so click
navigates. The`IconButton`uses`component={Link}` directly to avoid an
  extra nesting layer.
- Active state when `pathname` starts with the trash route — applies the
  `action.selected` background so users see when they're already on
  `/trash`.

### `workspace-user-menu.tsx`

Add a Notifications menu item between Профиль and Настройки:

```tsx
<MenuItem onClick={openNotifications}>
  <ListItemIcon>
    <Badge badgeContent={unread.data ?? 0} max={99} color="error">
      <NotificationsIcon fontSize="small" />
    </Badge>
  </ListItemIcon>
  <ListItemText>Уведомления</ListItemText>
</MenuItem>
```

Behavior:

- Click closes the user `Menu` and opens a separate `Popover` anchored to the
  original avatar element (re-uses the menu's anchor ref).
- Popover renders `NotificationsPopoverCard` with `onNavigate` closing the
  popover.
- Unread count uses the same query as the old sidebar trigger:
  `trpc.notification.unreadCount.useQuery(undefined, { refetchInterval: 30_000 })`.
  Query lives inside the user menu component now.

### `workspace-toolbar.tsx`

The fully-hidden state is gone, so the toolbar drops three props
(`sidebarHidden`, `onOpenSidebar`, `sidebarContent`) and the Popper-preview
logic. It becomes a thin breadcrumb + right-slot bar.

### `sidebar-notifications-trigger.tsx`

No longer used. Delete the file. The component's logic (unread badge +
popover) is reproduced inside `workspace-user-menu.tsx`. No other call sites.

## Interaction flows

### Mini ↔ Full toggle

- Mini: click the expand button → mode `'full'`, persisted.
- Full: click `KeyboardDoubleArrowLeftIcon` in the header → mode `'mini'`,
  persisted.
- No keyboard shortcut for now.

### Trash access

- From full mode: click the trash icon next to `+` in the Pages header.
- From mini mode: click the trash icon in the icon column.
- Both navigate to `/workspaces/{id}/trash`; tooltip "Корзина" on hover.

### Notifications access

- Click avatar (mini or full) → user menu opens.
- Click "Уведомления" → user menu closes, notifications popover opens
  anchored to the avatar.
- Click outside or `onNavigate` → popover closes.

## Testing

- E2E spec covering: default mini on first visit, toggle to full and back,
  persistence across reload, trash icon in pages header navigates to /trash,
  notifications menu item opens popover.
- Existing tests that assume `STORAGE_KEY = 'workspace.sidebar.collapsed'` or
  the bottom Trash/Notifications elements must be updated.

## Risks

- localStorage migration: users with `'workspace.sidebar.collapsed' = 'false'`
  saved (full mode preference) will get mini after this change. Acceptable —
  this is the new default and the toggle is one click away. We do not migrate.
- Notifications popover anchored to the avatar inside an open menu has a
  brief paint of two surfaces. Closing the menu before opening the popover
  prevents that.
- `WorkspaceUserMenu` is consumed in both mini and full sidebars. The compact
  (avatar-only) layout in mini is achieved with a `variant` prop, not a new
  component, so the menu definition stays in one place.
