# Sidebar collapse/hover redesign

Replace the current three-state sidebar (open 240px / collapsed 56px / n/a) with a two-state model (open / hidden) plus a hover popover for quick access.

## Current state

- `WorkspaceLayoutClient` manages `collapsed: boolean` persisted to `localStorage("workspace.sidebar.collapsed")`
- `WorkspaceSidebar` renders at 240px (open) or 56px (collapsed) with icon-only mode
- Toggle icon: `ChevronLeftIcon` / `ChevronRightIcon`
- `WorkspaceShell` uses CSS grid: `${sidebarWidth}px minmax(0, 1fr)`
- `WorkspaceToolbar` renders breadcrumbs, no menu icon

## New behavior

### Two states: open and hidden

| State      | Sidebar width             | Toolbar                               | Trigger                                                       |
| ---------- | ------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| **Open**   | 240px (unchanged)         | Breadcrumbs only (no menu icon)       | Click `KeyboardDoubleArrowLeftIcon` in sidebar header to hide |
| **Hidden** | 0px (removed from layout) | `MenuIcon` appears before breadcrumbs | Click `MenuIcon` to reopen                                    |

### Hover popover (when hidden)

- Hovering `MenuIcon` in toolbar opens a `Popper` (MUI) positioned below the icon, overlaying main content
- Popper content is identical to the full sidebar (workspace header, search, settings, pages, trash, user menu) but without the collapse toggle icon
- Popper closes only when the mouse leaves the popper area (including the MenuIcon trigger zone)
- Navigating within the popper (clicking a link) does NOT close it -- it stays open as long as the mouse is inside
- Clicking `MenuIcon` reopens the sidebar fully (switches to open state)

### Persistence

- `localStorage("workspace.sidebar.collapsed")` continues to store `"true"/"false"` for hidden/open
- Popper visibility is transient (mouse-driven), not persisted

## Components affected

### `WorkspaceSidebar` (`workspace-sidebar.tsx`)

- Remove all `collapsed` logic (56px mode, icon-only rendering, Tooltip wrappers on NavItem)
- Remove `collapsed` and `onToggleCollapsed` props
- Replace `ChevronLeftIcon`/`ChevronRightIcon` toggle with `KeyboardDoubleArrowLeftIcon` button
- Add `onHide` prop (called when user clicks the double-arrow icon)
- Component always renders at full 240px width -- it is either mounted or not

### `WorkspaceShell` (`workspace-shell.tsx`)

- When sidebar is hidden: single-column grid (`1fr`), no sidebar rendered
- When sidebar is open: `240px minmax(0, 1fr)` as now
- Remove `sidebarWidth` prop, replace with `sidebarVisible: boolean`
- Transition: animate grid-template-columns for smooth open/hide

### `WorkspaceToolbar` (`workspace-toolbar.tsx`)

- New prop: `sidebarHidden: boolean`
- New prop: `onOpenSidebar: () => void`
- New prop: `sidebarContent: ReactNode` (the sidebar content to render inside the popper)
- When `sidebarHidden`:
  - Render `MenuIcon` (`IconButton`) as the first element before breadcrumbs
  - On `MenuIcon` click: call `onOpenSidebar()`
  - On `MenuIcon` mouseEnter: show Popper
- Popper:
  - Uses MUI `Popper` + `Paper` for elevation/shadow
  - Anchored to the `MenuIcon` button
  - Placement: `bottom-start`
  - Width: 240px (matches sidebar)
  - The popper and the MenuIcon form a single hover zone: mouse can move between them without closing
  - onMouseLeave on the combined zone closes the popper

### `WorkspaceLayoutClient` (`workspace-layout-client.tsx`)

- Rename state: `collapsed` -> `hidden` (or `sidebarHidden`)
- localStorage key stays the same for backwards compat
- Remove `sidebarWidth` calculation (no more 56px)
- Pass `sidebarHidden`, `onHide`, `onOpenSidebar` to children
- Build sidebar ReactNode once and pass to both `WorkspaceShell` (when open, renders in grid) and `WorkspaceToolbar` (when hidden, renders inside popper)

### `SearchSidebarSection` (`search-sidebar-section.tsx`)

- Remove `collapsed` prop and all collapsed-mode rendering

### `WorkspaceUserMenu` (`workspace-user-menu.tsx`)

- Remove `collapsed` prop and collapsed-mode rendering

### `NavItem` (inside `workspace-sidebar.tsx`)

- Remove `collapsed` prop, Tooltip wrapper for collapsed mode
- Always renders full label

### Icon exports (`packages/ui/src/components/index.ts`)

- Add export: `KeyboardDoubleArrowLeftIcon` from `@mui/icons-material`
- Add export: `MenuIcon` from `@mui/icons-material`
- `ChevronLeftIcon` and `ChevronRightIcon` can remain (may be used elsewhere)

## Hover zone implementation detail

The tricky part: the popper and MenuIcon must act as a single hover region. When the mouse moves from MenuIcon into the popper (crossing a gap), the popper must not close. Approach:

- Wrap both `MenuIcon` and `Popper` in a container `Box`
- Use `onMouseEnter` on the container to show popper
- Use `onMouseLeave` on the container to hide popper
- The container is only rendered when `sidebarHidden` is true
- Use a small delay (100-150ms) on mouseLeave before closing, cancelled by mouseEnter, to handle gap-crossing

## Out of scope

- Mobile/responsive sidebar behavior
- Keyboard shortcuts for toggle
- Animation of popper appearance (use MUI Popper default)
