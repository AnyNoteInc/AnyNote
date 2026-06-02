# Plan-gating UI + Share Permissions Fix — Implementation Plan (Spec 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Personal-plan UI (chat sidebar + 3 settings sections), polish settings nav (rename Файлы→Библиотека, icons, bug fix), and fix shared-page permissions so a commenter/reader cannot edit any board type, including kanban (server + client).

**Architecture:** Plan-feature flags already flow server→client via `PlanFeaturesProvider`/`usePlanFeatures()`. We thread `features` into the sidebar to hide the chat button and gate settings items, and reuse server route guards. For sharing, `PageRenderer` already receives `editable`; we propagate it to every board branch (boards already accept it; genogram uses `mode`). For kanban we add a role-aware `assertCanEdit` guard in the domain service and align tRPC kanban operations, plus thread `editable` into the kanban client to hide edit affordances while keeping commenting.

**Tech Stack:** Next.js 16 / React 19 / MUI v6 (apps/web), tRPC v11, `@repo/domain` (vitest), Prisma, Playwright (apps/e2e). Tests: `vitest run` for apps/web and packages/domain; Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-06-02-plan-gating-and-share-permissions-design.md`

**Conventions:** Prettier `semi: false`, single quotes, 100-col. Conventional Commits with scope. Run from repo root unless noted. Commit after each task.

---

## File Structure

**Section A — chat sidebar gating**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx` (add `features` prop, gate chat button)
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx` (pass `features`; default-section guard)
- Test: `apps/web/test/workspace-section-switcher.test.tsx` (new)

**Section B — settings nav + rename + icons + bug fix**
- Modify: `packages/ui/src/components/index.ts` (add 8 missing icon re-exports)
- Modify: `apps/web/src/components/workspace/workspace-settings-nav.tsx` (gate by flags, rename, icons)
- Modify: `apps/web/src/components/workspace/settings/files-section.tsx` (card title rename)
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx` (`'free'`→`'personal'`)
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx` (guard `customMcpEnabled`)
- Test: `apps/web/test/workspace-settings-nav.test.tsx` (new)

**Section D — editable propagation to boards**
- Modify: `apps/web/src/components/page/page-renderer.tsx` (pass `editable`/`mode` to each branch)
- Test: `apps/web/test/page-renderer-editable.test.tsx` (new)

**Section E — kanban role enforcement (server) + client gating**
- Modify: `packages/domain/src/kanban/services/kanban.service.ts` (add `assertCanEdit`, `assertCanComment`; swap guards)
- Test: `packages/domain/test/kanban/service.test.ts` (extend)
- Modify: `packages/trpc/src/routers/kanban/column.ts` and `.../task.ts` (align to edit-level where over-strict)
- Modify: `apps/web/src/components/page/page-renderer.tsx` (pass `editable` to KanbanBoardPage)
- Modify: `apps/web/src/components/kanban/kanban-board-page.tsx` + toolbar/board/column views (hide edit affordances)
- Test: `apps/web/test/kanban-board-page-editable.test.tsx` (new)

**Section C — share render verification (E2E)**
- Test: `apps/e2e/share-page-types.spec.ts` (new) and `apps/e2e/share-commenter-readonly.spec.ts` (new)

---

## Section A — Hide chat in workspace sidebar (Personal plan)

### Task A1: Thread `features` into the sidebar and gate the chat button

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`
- Test: `apps/web/test/workspace-section-switcher.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/workspace-section-switcher.test.tsx`. The switcher is a private function, so we export it for testing. Test the public `WorkspaceSidebar` via its `features` prop instead — render it with a minimal harness. Because `WorkspaceSidebar` pulls in trpc-heavy children, we test the extracted switcher. First, export `WorkspaceSectionSwitcher` from the module (done in Step 3); the test imports it.

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceSectionSwitcher } from '@/components/workspace/workspace-sidebar'

const noop = vi.fn()

function renderSwitcher(chatsEnabled: boolean) {
  return render(
    <WorkspaceSectionSwitcher
      activeSection="pages"
      chatsEnabled={chatsEnabled}
      onChats={noop}
      onPages={noop}
      onSearch={noop}
      onSettings={noop}
    />,
  )
}

describe('WorkspaceSectionSwitcher', () => {
  afterEach(cleanup)

  it('shows the chat button when chats are enabled', () => {
    renderSwitcher(true)
    expect(screen.getByRole('button', { name: 'Чаты' })).toBeInTheDocument()
  })

  it('hides the chat button when chats are disabled', () => {
    renderSwitcher(false)
    expect(screen.queryByRole('button', { name: 'Чаты' })).not.toBeInTheDocument()
    // Search/Pages/Settings remain.
    expect(screen.getByRole('button', { name: 'Поиск' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Страницы' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Настройки' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run test/workspace-section-switcher.test.tsx`
Expected: FAIL — `WorkspaceSectionSwitcher` is not exported (import error) / `chatsEnabled` prop unknown.

- [ ] **Step 3: Implement — export the switcher, add `chatsEnabled`, gate the button**

In `apps/web/src/components/workspace/workspace-sidebar.tsx`:

(a) Change the switcher to `export function` and add `chatsEnabled` to its params and inline prop type:

```tsx
export function WorkspaceSectionSwitcher({
  activeSection,
  chatsEnabled,
  onChats,
  onPages,
  onSearch,
  onSettings,
}: {
  activeSection: WorkspaceSidebarSection
  chatsEnabled: boolean
  onChats: () => void
  onPages: () => void
  onSearch: () => void
  onSettings: () => void
}) {
```

(b) Wrap the "Чаты" `<Tooltip>…</Tooltip>` block in a conditional so it renders only when enabled:

```tsx
      {chatsEnabled ? (
        <Tooltip title={`Чаты (${shortcut('⌘P', 'Alt+P')})`}>
          <Button
            aria-label="Чаты"
            aria-pressed={activeSection === 'chats'}
            onClick={onChats}
            style={activeSection === 'chats' ? activeButtonStyle : undefined}
          >
            <ChatBubbleOutlineIcon fontSize="small" />
          </Button>
        </Tooltip>
      ) : null}
```

(c) Add `features` to the `WorkspaceSidebar` Props type and destructuring:

```tsx
type Props = Readonly<{
  workspace: { id: string; name: string; icon: string | null }
  features: PlanFeatures
  pages: PageItem[]
  onHide?: () => void
  userMenu: ReactNode
  activeSection: WorkspaceSidebarSection
  onSectionChange: (section: WorkspaceSidebarSection) => void
}>
```

```tsx
export function WorkspaceSidebar({
  workspace,
  features,
  pages,
  onHide,
  userMenu,
  activeSection,
  onSectionChange,
}: Props) {
```

(d) Add the `PlanFeatures` type import to the top import block (alongside the existing `WorkspaceSidebarSection` type import):

```tsx
import type { PlanFeatures } from '@repo/trpc'
```

(e) Pass `chatsEnabled` at the switcher call site (lines ~173):

```tsx
      <WorkspaceSectionSwitcher
        activeSection={activeSection}
        chatsEnabled={features.chatsEnabled}
        onChats={() => {
          onSectionChange('chats')
        }}
        onPages={() => onSectionChange('pages')}
        onSearch={searchDialog.open}
        onSettings={() => {
          onSectionChange('settings')
          router.push(`/workspaces/${workspace.id}/settings/general`)
        }}
      />
```

(f) Guard the chats section body so a coerced/stale `activeSection === 'chats'` while disabled shows nothing odd — render the chat section only when enabled:

```tsx
        {activeSection === 'chats' && features.chatsEnabled ? (
          <SearchSidebarSection workspaceId={workspace.id} />
        ) : null}
```

In `apps/web/src/components/workspace/workspace-layout-client.tsx`:

(g) Add `features` to `sidebarProps`:

```tsx
  const sidebarProps = {
    workspace,
    features,
    pages,
    userMenu,
    activeSection: sidebarSection,
    onSectionChange: setSidebarSection,
  }
```

(h) Make the default section avoid `'chats'` when chats are disabled. Replace the `sidebarSection` initializer:

```tsx
  const [sidebarSection, setSidebarSection] = useState<WorkspaceSidebarSection>(() => {
    const fromPath = sidebarSectionFromPathname(pathname)
    if (fromPath) return fromPath
    return features.chatsEnabled ? 'chats' : 'pages'
  })
```

(i) When chats become disabled but the active section is `'chats'`, coerce to `'pages'`. Add an effect after the existing pathname effect:

```tsx
  useEffect(() => {
    if (!features.chatsEnabled && sidebarSection === 'chats') {
      setSidebarSection('pages')
    }
  }, [features.chatsEnabled, sidebarSection])
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run test/workspace-section-switcher.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check the web app**

Run: `pnpm --filter web check-types`
Expected: no errors. (If `.next/types` reports a stale deleted-route error, `rm -rf apps/web/.next/types` and re-run.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx \
        apps/web/src/components/workspace/workspace-layout-client.tsx \
        apps/web/test/workspace-section-switcher.test.tsx
git commit -m "feat(web): hide chat sidebar section on plans without chatsEnabled"
```

---

## Section B — Settings nav: gate sections, rename Files, icons, bug fix

### Task B1: Add the 8 missing MUI icon re-exports

**Files:**
- Modify: `packages/ui/src/components/index.ts`

These icons are used by Task B2 and are NOT yet re-exported: `GroupIcon`, `SmartToyIcon`, `HubIcon`, `StorageIcon`, `LibraryBooksIcon`, `BarChartIcon`, `InsightsIcon`, `WarningAmberIcon`. (We only add the ones B2 actually uses; see B2 for the final mapping. The final set used by B2 is: `GroupIcon`, `SmartToyIcon`, `HubIcon`, `StorageIcon`, `WarningAmberIcon`. `SettingsIcon`, `LeakAddIcon`, `InsertDriveFileIcon`, `DeleteIcon` already exist.)

- [ ] **Step 1: Inspect the existing icon re-export pattern**

Run: `grep -n "Icon } from '@mui/icons-material" packages/ui/src/components/index.ts | head -5`
Expected: lines like `export { default as SettingsIcon } from '@mui/icons-material/Settings'`.

- [ ] **Step 2: Add the new re-exports**

Append to the icon re-export region of `packages/ui/src/components/index.ts` (match the existing `export { default as XIcon } from '@mui/icons-material/X'` style; place alphabetically near siblings if the file is sorted, otherwise at the end of the icon block):

```ts
export { default as GroupIcon } from '@mui/icons-material/Group'
export { default as SmartToyIcon } from '@mui/icons-material/SmartToy'
export { default as HubIcon } from '@mui/icons-material/Hub'
export { default as StorageIcon } from '@mui/icons-material/Storage'
export { default as WarningAmberIcon } from '@mui/icons-material/WarningAmber'
```

- [ ] **Step 3: Verify the exports resolve**

Run: `pnpm --filter web exec tsc --noEmit -p ../../packages/ui/tsconfig.json 2>/dev/null || pnpm --filter @repo/ui check-types`
(If `@repo/ui` has no `check-types` script, instead verify via the consuming app in Task B2's type-check.)
Expected: no error about these modules.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): re-export Group/SmartToy/Hub/Storage/WarningAmber icons"
```

### Task B2: Gate settings items by plan flags, rename Файлы→Библиотека, add icons

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-settings-nav.tsx`
- Test: `apps/web/test/workspace-settings-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/workspace-settings-nav.test.tsx`. Mock `usePlanFeatures` and `next/navigation`.

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlanFeatures } from '@repo/trpc'

const mocks = vi.hoisted(() => ({ features: { current: null as PlanFeatures | null } }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspaces/w1/settings/general',
}))

vi.mock('@/components/workspace/plan-features-context', () => ({
  usePlanFeatures: () => mocks.features.current,
}))

import { WorkspaceSettingsNav } from '@/components/workspace/workspace-settings-nav'

function feats(overrides: Partial<PlanFeatures>): PlanFeatures {
  return {
    slug: 'personal',
    name: 'Персональный',
    sortOrder: 1,
    isPaid: false,
    maxWorkspaces: 1,
    maxMembersPerWorkspace: 1,
    chatsEnabled: false,
    pageIndexingEnabled: false,
    membersSettingsEnabled: false,
    aiSettingsEnabled: false,
    customMcpEnabled: false,
    customAiProvidersEnabled: false,
    prioritySupport: false,
    developerSpaceEnabled: false,
    ...overrides,
  }
}

describe('WorkspaceSettingsNav', () => {
  afterEach(cleanup)

  it('on Personal hides Members/AI/MCP and shows the rest, with Библиотека label', () => {
    mocks.features.current = feats({})
    render(<WorkspaceSettingsNav workspaceId="w1" />)
    expect(screen.queryByRole('link', { name: /Участники/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /AI агент/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /MCP серверы/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Общее/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Библиотека/ })).toBeInTheDocument()
    expect(screen.queryByText('Файлы')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Использование/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Опасная зона/ })).toBeInTheDocument()
  })

  it('on a full plan shows Members/AI/MCP', () => {
    mocks.features.current = feats({
      membersSettingsEnabled: true,
      aiSettingsEnabled: true,
      customMcpEnabled: true,
    })
    render(<WorkspaceSettingsNav workspaceId="w1" />)
    expect(screen.getByRole('link', { name: /Участники/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /AI агент/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /MCP серверы/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run test/workspace-settings-nav.test.tsx`
Expected: FAIL — Members/AI/MCP still rendered (static `show: true`); "Файлы" still present.

- [ ] **Step 3: Implement the gated, icon-rich, renamed nav**

Replace the entire `apps/web/src/components/workspace/workspace-settings-nav.tsx` with:

```tsx
'use client'

import type { ReactNode } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  Box,
  DeleteIcon,
  GroupIcon,
  HubIcon,
  InsertDriveFileIcon,
  LeakAddIcon,
  SettingsIcon,
  SmartToyIcon,
  Stack,
  StorageIcon,
  Typography,
  WarningAmberIcon,
} from '@repo/ui/components'

import { usePlanFeatures } from '@/components/workspace/plan-features-context'

type Props = { workspaceId: string }

export function WorkspaceSettingsNav({ workspaceId }: Props) {
  const pathname = usePathname()
  const features = usePlanFeatures()
  const base = `/workspaces/${workspaceId}/settings`

  const items: Array<{ label: string; slug: string; icon: ReactNode; show: boolean }> = [
    { label: 'Общее', slug: 'general', icon: <SettingsIcon fontSize="small" />, show: true },
    {
      label: 'Участники',
      slug: 'members',
      icon: <GroupIcon fontSize="small" />,
      show: features.membersSettingsEnabled,
    },
    {
      label: 'AI агент',
      slug: 'ai',
      icon: <SmartToyIcon fontSize="small" />,
      show: features.aiSettingsEnabled,
    },
    {
      label: 'MCP серверы',
      slug: 'mcp',
      icon: <HubIcon fontSize="small" />,
      show: features.customMcpEnabled,
    },
    {
      label: 'Библиотека',
      slug: 'files',
      icon: <StorageIcon fontSize="small" />,
      show: true,
    },
    {
      label: 'Использование',
      slug: 'usage',
      icon: <InsertDriveFileIcon fontSize="small" />,
      show: true,
    },
    {
      label: 'Опасная зона',
      slug: 'danger',
      icon: <WarningAmberIcon fontSize="small" />,
      show: true,
    },
  ].filter((item) => item.show)

  return (
    <Stack spacing={0.5} component="nav">
      {items.map((item) => {
        const href = `${base}/${item.slug}`
        const active = pathname === href
        return (
          <Box
            key={item.slug}
            component={Link}
            href={href}
            aria-current={active ? 'page' : undefined}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              padding: '6px 10px',
              borderRadius: 0.75,
              textDecoration: 'none',
              fontSize: 14,
              color: active ? 'text.primary' : 'text.secondary',
              bgcolor: active ? 'action.selected' : 'transparent',
              '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
            }}
          >
            {item.icon}
            <Typography variant="body2">{item.label}</Typography>
          </Box>
        )
      })}
    </Stack>
  )
}
```

(Note: `LeakAddIcon` import is unused here — remove it. The import list above already omits it; keep imports exactly as shown. `DeleteIcon` is also unused above — remove it from the import list. Final imports must contain only: `Box`, `GroupIcon`, `HubIcon`, `InsertDriveFileIcon`, `SettingsIcon`, `SmartToyIcon`, `Stack`, `StorageIcon`, `Typography`, `WarningAmberIcon`.)

- [ ] **Step 4: Fix the import list to only-used icons**

Ensure the import block is exactly:

```tsx
import {
  Box,
  GroupIcon,
  HubIcon,
  InsertDriveFileIcon,
  SettingsIcon,
  SmartToyIcon,
  Stack,
  StorageIcon,
  Typography,
  WarningAmberIcon,
} from '@repo/ui/components'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run test/workspace-settings-nav.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/workspace/workspace-settings-nav.tsx \
        apps/web/test/workspace-settings-nav.test.tsx
git commit -m "feat(web): gate settings nav by plan flags, add icons, rename Файлы→Библиотека"
```

### Task B3: Rename the Files settings card title

**Files:**
- Modify: `apps/web/src/components/workspace/settings/files-section.tsx`

- [ ] **Step 1: Update the card title**

In `apps/web/src/components/workspace/settings/files-section.tsx` (around line 142), change:

```tsx
    <SettingsCard
      title="Файлы"
      description="Все файлы, загруженные в этом workspace."
    >
```

to:

```tsx
    <SettingsCard
      title="Библиотека"
      description="Все файлы, загруженные в этом workspace."
    >
```

- [ ] **Step 2: Verify no other "Файлы" titles remain in this section**

Run: `grep -rn "Файлы" apps/web/src/components/workspace/settings/files-section.tsx`
Expected: no matches (the card title was the only one). If other matches refer to user-facing headers, leave column/table headers as-is unless they are the page title.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/settings/files-section.tsx
git commit -m "feat(web): rename Files settings card title to Библиотека"
```

### Task B4: Fix members `locked` slug bug + align MCP route guard

**Files:**
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx`

- [ ] **Step 1: Fix the members `locked` check**

In `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx`, change:

```tsx
      locked={plan.slug === 'free'}
```

to:

```tsx
      locked={plan.slug === 'personal'}
```

- [ ] **Step 2: Align the MCP route guard with the nav gate**

In `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx`, change the guard so the route agrees with the nav (which gates MCP on `customMcpEnabled`):

```tsx
  if (!features.customMcpEnabled) notFound()
```

(Replaces `if (!features.aiSettingsEnabled) notFound()`.)

- [ ] **Step 3: Type-check the web app**

Run: `pnpm --filter web check-types`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx" \
        "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx"
git commit -m "fix(web): members locked uses 'personal' slug; MCP route guards customMcpEnabled"
```

---

## Section D — Propagate `editable` to every board (commenter cannot edit)

### Task D1: Pass `editable`/`mode` to each board branch in PageRenderer

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Test: `apps/web/test/page-renderer-editable.test.tsx`

Boards already accept `editable` (Excalidraw `Board`, and Mermaid/PlantUML/LikeC4 via `{...props}` to `DiagramBoard`). Genogram uses `mode`. DrawIO accepts but ignores it (by design — keep parity). Kanban is handled in Section E (Task E3). This task wires the diagram/board branches.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/page-renderer-editable.test.tsx`. We mock each board to a sentinel that echoes the props it received, and assert `editable`/`mode` reach them. Mock heavy deps (`next/dynamic` returns the component directly; trpc, yjs-config, hooks).

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// next/dynamic: return a passthrough that renders a sentinel echoing props.
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, _opts: unknown) => {
    return function Dyn(props: Record<string, unknown>) {
      return (
        <div
          data-testid="board"
          data-editable={String(props.editable)}
          data-mode={String(props.mode)}
        />
      )
    }
  },
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/trpc/client', () => ({
  trpc: {
    file: { attachToPage: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    page: { listByWorkspace: { useQuery: () => ({ data: [] }) } },
    useUtils: () => ({ page: { listByWorkspace: { ensureData: vi.fn(async () => []) } } }),
  },
}))
vi.mock('@/lib/yjs-config', () => ({ resolveYjsUrl: () => 'ws://x', fetchYjsToken: vi.fn() }))
vi.mock('@/lib/drawio-config', () => ({ resolveDrawioUrl: () => 'http://x' }))
vi.mock('@/lib/upload-handler', () => ({ createUploadHandler: () => vi.fn() }))
vi.mock('@/hooks/use-outline-mode', () => ({ useOutlineMode: () => ['off'] }))
vi.mock('./editor-context', () => ({ usePageEditor: () => ({ setEditor: vi.fn() }) }), {
  virtual: true,
})
vi.mock('@/components/page/editor-context', () => ({ usePageEditor: () => ({ setEditor: vi.fn() }) }))
vi.mock('@/components/page/comments/comments-context', () => ({
  usePageCommentsContext: () => ({
    anchors: [],
    canComment: false,
    startNewThread: vi.fn(),
    openThreadPopover: vi.fn(),
    activeAnchor: null,
    panelOpen: false,
  }),
}))
vi.mock('@/components/page/use-reminder-sync', () => ({ useReminderSync: vi.fn() }))
vi.mock('@/components/page/comments/use-mention-search', () => ({
  useWorkspaceMentionSearch: () => vi.fn(),
}))

import { PageRenderer } from '@/components/page/page-renderer'

const user = { id: 'u1', name: 'U', color: '#000' }

function renderType(type: string) {
  return render(
    <PageRenderer
      page={{ id: 'p1', type: type as never, contentYjs: null }}
      workspaceId="w1"
      user={user}
      editable={false}
    />,
  )
}

describe('PageRenderer editable propagation', () => {
  afterEach(cleanup)

  it.each(['EXCALIDRAW', 'MERMAID', 'PLANTUML', 'LIKEC4', 'DRAWIO'])(
    'passes editable=false to %s board',
    (type) => {
      renderType(type)
      expect(screen.getByTestId('board').dataset.editable).toBe('false')
    },
  )

  it('passes mode=readonly to GENOGRAM when not editable', () => {
    renderType('GENOGRAM')
    expect(screen.getByTestId('board').dataset.mode).toBe('readonly')
  })
})
```

> Note for implementer: the exact set of `vi.mock` paths may need small adjustments to match the real import specifiers in `page-renderer.tsx` (some imports are from `'./...'` relative paths). If a mock path is wrong, vitest throws "cannot find module"; fix the specifier to match the import in the file. The assertions (editable/mode values) are the contract.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run test/page-renderer-editable.test.tsx`
Expected: FAIL — boards render with `data-editable="undefined"` / `data-mode="undefined"` because PageRenderer doesn't pass them.

- [ ] **Step 3: Implement — add `editable`/`mode` to each branch**

In `apps/web/src/components/page/page-renderer.tsx`, update each board branch:

EXCALIDRAW (add `editable={editable}`):

```tsx
  if (page.type === 'EXCALIDRAW') {
    return (
      <Board
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        uploadHandler={uploadHandler}
        user={user}
        editable={editable}
      />
    )
  }
```

GENOGRAM (map to `mode`):

```tsx
  if (page.type === 'GENOGRAM') {
    return (
      <Genogram
        pageId={page.id}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        mode={editable ? 'editor' : 'readonly'}
      />
    )
  }
```

MERMAID (add `editable={editable}`):

```tsx
  if (page.type === 'MERMAID') {
    return (
      <MermaidBoard
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        editable={editable}
      />
    )
  }
```

PLANTUML (add `editable={editable}`):

```tsx
  if (page.type === 'PLANTUML') {
    return (
      <PlantumlBoard
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        renderAuth={renderAuth}
        editable={editable}
      />
    )
  }
```

LIKEC4 (add `editable={editable}`):

```tsx
  if (page.type === 'LIKEC4') {
    return (
      <Likec4Board
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        editable={editable}
      />
    )
  }
```

DRAWIO (add `editable={editable}` for parity — accepted-but-ignored by the wrapper):

```tsx
  if (page.type === 'DRAWIO') {
    return (
      <DrawioBoard
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        drawioUrl={resolveDrawioUrl()}
        editable={editable}
      />
    )
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run test/page-renderer-editable.test.tsx`
Expected: PASS (6 cases).

- [ ] **Step 5: Type-check**

Run: `pnpm --filter web check-types`
Expected: no errors. (Genogram `mode` type is `'readonly' | 'editor'`; the ternary yields that union.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx \
        apps/web/test/page-renderer-editable.test.tsx
git commit -m "fix(web): propagate editable/mode to all board renderers so commenters can't edit"
```

---

## Section E — Kanban: server role enforcement + client editable-gating

### Task E1: Add role-aware edit/comment guards to the kanban domain service

**Files:**
- Modify: `packages/domain/src/kanban/services/kanban.service.ts`
- Test: `packages/domain/test/kanban/service.test.ts`

Current guards: task mutations (`createTask`, `updateTask`, `moveTask`, `setTaskAssignees`, `archiveTask`) and `createTaskComment` use `assertAccess` (membership only). We add:
- `assertCanEdit(userId, pageId)` — requires creator OR role ∈ {OWNER, ADMIN, EDITOR}.
- `assertCanComment(userId, pageId)` — requires creator OR role ∈ {OWNER, ADMIN, EDITOR, COMMENTER}.

Then swap: task mutations → `assertCanEdit`; `createTaskComment` → `assertCanComment`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/test/kanban/service.test.ts` (reuse its `makeRepo`/`makeService` helpers):

```typescript
describe('kanban role enforcement', () => {
  it('createTask is forbidden for a COMMENTER member who is not the creator', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'COMMENTER'),
    })
    const svc = makeService(repo)
    await expect(
      svc.createTask('u1', { pageId: 'b1', columnId: 'c1', title: 'X' } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createTask is forbidden for a VIEWER member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
    })
    const svc = makeService(repo)
    await expect(
      svc.createTask('u1', { pageId: 'b1', columnId: 'c1', title: 'X' } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createTask succeeds for an EDITOR member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'),
    })
    const svc = makeService(repo)
    await expect(
      svc.createTask('u1', { pageId: 'b1', columnId: 'c1', title: 'X' } as never),
    ).resolves.toBeDefined()
  })

  it('createTaskComment succeeds for a COMMENTER member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'COMMENTER'),
      findTaskPageId: vi.fn(async () => ({ pageId: 'b1' })),
    })
    const svc = makeService(repo)
    await expect(
      svc.createTaskComment('u1', { pageId: 'b1', taskId: 't1', content: { text: 'hi' } } as never),
    ).resolves.toBeDefined()
  })

  it('createTaskComment is forbidden for a VIEWER member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
      findTaskPageId: vi.fn(async () => ({ pageId: 'b1' })),
    })
    const svc = makeService(repo)
    await expect(
      svc.createTaskComment('u1', { pageId: 'b1', taskId: 't1', content: { text: 'hi' } } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createTask succeeds for the board creator regardless of role', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u1' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
    })
    const svc = makeService(repo)
    await expect(
      svc.createTask('u1', { pageId: 'b1', columnId: 'c1', title: 'X' } as never),
    ).resolves.toBeDefined()
  })
})
```

> Note: `DomainError` carries `code` (e.g. `'FORBIDDEN'`). Confirm the existing tests assert on `.code` (they do for `assertOwnership`); if they assert on `message` instead, mirror that style. Check the existing forbidden-path test in the file and match its assertion shape.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @repo/domain exec vitest run test/kanban/service.test.ts`
Expected: FAIL — `createTask`/`createTaskComment` currently succeed for COMMENTER/VIEWER (no role check).

- [ ] **Step 3: Implement the guards and swap call sites**

In `packages/domain/src/kanban/services/kanban.service.ts`, add two private helpers next to `assertAccess`/`assertOwnership`:

```typescript
  private async assertCanEdit(userId: string, pageId: string): Promise<AccessiblePage> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const role = await this.repo.findMembershipRole(userId, page.workspaceId)
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'EDITOR') {
      throw forbidden('Недостаточно прав на редактирование')
    }
    return page
  }

  private async assertCanComment(userId: string, pageId: string): Promise<AccessiblePage> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const role = await this.repo.findMembershipRole(userId, page.workspaceId)
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'EDITOR' && role !== 'COMMENTER') {
      throw forbidden('Недостаточно прав на комментирование')
    }
    return page
  }
```

Then change the first line of each mutating task method to use `assertCanEdit` instead of `assertAccess`:
- `createTask`: `const page = await this.assertCanEdit(actorUserId, input.pageId)`
- `updateTask`: `const page = await this.assertCanEdit(actorUserId, input.pageId)`
- `moveTask`: `const page = await this.assertCanEdit(actorUserId, input.pageId)`
- `setTaskAssignees`: `const page = await this.assertCanEdit(actorUserId, input.pageId)` (match its current variable name; if it doesn't bind `page`, just replace `assertAccess` with `assertCanEdit`)
- `archiveTask`: replace `assertAccess` with `assertCanEdit`

And change `createTaskComment`'s first line:

```typescript
  async createTaskComment(actorUserId: string, input: CreateTaskCommentInput) {
    await this.assertCanComment(actorUserId, input.pageId)
```

> Leave `createSprint`/`activateSprint`/`completeSprint` on `assertOwnership` (stricter, unchanged).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @repo/domain exec vitest run test/kanban/service.test.ts`
Expected: PASS (new tests + existing tests still green).

- [ ] **Step 5: Type-check the domain package**

Run: `pnpm --filter @repo/domain check-types`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/kanban/services/kanban.service.ts \
        packages/domain/test/kanban/service.test.ts
git commit -m "fix(domain): enforce editor/commenter roles on kanban task mutations and comments"
```

### Task E2: Align over-strict tRPC kanban guards with edit-level access

**Files:**
- Modify: `packages/trpc/src/routers/kanban/column.ts`
- Modify: `packages/trpc/src/routers/kanban/task.ts`

Column ops and `task.setLabels`/`task.unarchive` use `assertPageOwnership` (OWNER-only) or `assertPageAccess` (any member) in the tRPC layer. To make EDITOR a true editor (and keep COMMENTER out), route these through the domain `assertCanEdit` semantics. The simplest consistent fix: replace the tRPC `assertPageOwnership`/`assertPageAccess` calls in these editing operations with a shared edit-access helper that mirrors `assertCanEdit`.

- [ ] **Step 1: Add an edit-access helper in the tRPC page-access helpers**

In `packages/trpc/src/helpers/page-access.ts`, add:

```typescript
export async function assertPageEditAccess(ctx: Ctx, pageId: string) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: { members: { some: { userId: ctx.user.id } } },
    },
  })
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  if (page.createdById === ctx.user.id) return page
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
  })
  if (member?.role !== 'OWNER' && member?.role !== 'ADMIN' && member?.role !== 'EDITOR') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на редактирование' })
  }
  return page
}
```

- [ ] **Step 2: Use it in column.ts editing ops**

In `packages/trpc/src/routers/kanban/column.ts`, replace each `assertPageOwnership(ctx, input.pageId)` in `create`/`update`/`reorder`/`delete` with `assertPageEditAccess(ctx, input.pageId)`, and update the import:

```typescript
import { assertPageEditAccess } from '../../helpers/page-access'
```

(Replace the existing `assertPageOwnership` import if it's no longer used in this file.)

- [ ] **Step 3: Use it in task.ts setLabels and unarchive**

In `packages/trpc/src/routers/kanban/task.ts`, replace `assertPageAccess(ctx, input.pageId)` with `assertPageEditAccess(ctx, input.pageId)` in `setLabels` and `unarchive`. Keep `softDelete` as-is (it has its own creator/owner logic). Update the import to include `assertPageEditAccess`.

- [ ] **Step 4: Type-check tRPC**

Run: `pnpm --filter @repo/trpc check-types`
Expected: no errors. (If `assertPageOwnership` becomes unused anywhere, remove the dangling import in that file only.)

- [ ] **Step 5: Run the tRPC test suite**

Run: `pnpm --filter @repo/trpc test`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/helpers/page-access.ts \
        packages/trpc/src/routers/kanban/column.ts \
        packages/trpc/src/routers/kanban/task.ts
git commit -m "fix(trpc): kanban column/label/unarchive ops require editor-level access"
```

### Task E3: Thread `editable` into the kanban client and hide edit affordances

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Modify: `apps/web/src/components/kanban/kanban-board-page.tsx`
- Modify: `apps/web/src/components/kanban/kanban-toolbar.tsx`
- Modify: `apps/web/src/components/kanban/views/board-view.tsx` (AddColumnForm gating)
- Modify: `apps/web/src/components/kanban/views/board-column.tsx` (AddCardForm gating)
- Test: `apps/web/test/kanban-board-page-editable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/kanban-board-page-editable.test.tsx`. Mock trpc's `kanban.board.getBoard` to return a minimal board and the realtime hook, then assert that with `editable={false}` the "add column" / "add card" affordances are not rendered.

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const board = {
  columns: [{ id: 'c1', name: 'To do', position: 1 }],
  tasks: [],
  sprints: [],
  labels: [],
  types: [],
  priorities: [],
}

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/trpc/client', () => ({
  trpc: {
    kanban: {
      board: { getBoard: { useQuery: () => ({ data: board, isLoading: false, error: null }) } },
    },
  },
}))
vi.mock('@/components/kanban/realtime/use-kanban-events', () => ({ useKanbanEvents: vi.fn() }))

import { KanbanBoardPage } from '@/components/kanban/kanban-board-page'

describe('KanbanBoardPage editable gating', () => {
  afterEach(cleanup)

  it('hides the add-column affordance when not editable', () => {
    render(<KanbanBoardPage pageId="p1" editable={false} />)
    expect(screen.queryByRole('button', { name: /колонк/i })).not.toBeInTheDocument()
  })

  it('shows the add-column affordance when editable', () => {
    render(<KanbanBoardPage pageId="p1" editable />)
    expect(screen.getByRole('button', { name: /колонк/i })).toBeInTheDocument()
  })
})
```

> Note: the exact accessible name of the add-column control must match the real button/text in `board-view.tsx`'s `AddColumnForm`. Open that file and use the real label (e.g. "Добавить колонку"). Adjust the regex accordingly. If the control is a text trigger rather than a `role=button`, query by text. The contract is: not present when `editable=false`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run test/kanban-board-page-editable.test.tsx`
Expected: FAIL — `KanbanBoardPage` has no `editable` prop; add-column shows regardless.

- [ ] **Step 3: Add `editable` to KanbanBoardPage and thread it down**

In `apps/web/src/components/kanban/kanban-board-page.tsx`:

```tsx
interface KanbanBoardPageProps {
  readonly pageId: string
  readonly editable?: boolean
}

export function KanbanBoardPage({ pageId, editable = true }: KanbanBoardPageProps) {
```

Pass `editable` to the toolbar and the views:

```tsx
        <KanbanToolbar pageId={pageId} filtersBag={filtersBag} board={board} editable={editable} />
```

```tsx
            {filtersBag.view === 'board' && (
              <BoardView pageId={pageId} board={board} visibleTasks={visibleTasks} editable={editable} />
            )}
            {filtersBag.view === 'table' && (
              <TableView pageId={pageId} board={board} visibleTasks={tableViewTasks} editable={editable} />
            )}
            {filtersBag.view === 'gantt' && (
              <GanttView pageId={pageId} board={board} visibleTasks={visibleTasks} editable={editable} />
            )}
```

```tsx
      <TaskDetailContainer pageId={pageId} board={board} editable={editable} />
```

- [ ] **Step 4: Add `editable` props to the child components and gate affordances**

For each child, add `editable?: boolean` (default `true`) to its props type and:
- `KanbanToolbar` (`kanban-toolbar.tsx`): add `readonly editable?: boolean` to `KanbanToolbarProps`; hide create-task / mutating controls when `!editable`.
- `BoardView` (`views/board-view.tsx`): add `editable?: boolean`; render `AddColumnForm` only when `editable`; pass `editable` to each `BoardColumn` (rendered at line ~82 as `<BoardColumn key={column.id} pageId={pageId} column={column} board={board} />`).
- `BoardColumn` (`views/board-column.tsx`): add `editable?: boolean`; render `AddCardForm` and drag handles only when `editable`.
- `TableView` (`views/table-view.tsx`), `GanttView` (`views/gantt-view.tsx`), `TaskDetailContainer` (`task/task-detail-container.tsx`): add `editable?: boolean` and disable/hide mutating controls when `!editable`; in `TaskDetailContainer` keep the comment composer visible (comments are allowed for commenters) while hiding edit fields.

> Implementer: make the minimal edit to satisfy the test first (gate `AddColumnForm` in `BoardView`), then extend gating to the other mutating affordances (add-card, drag-and-drop enable, delete buttons, label/assignee editors). Keep the comment composer in task detail visible regardless of `editable` (commenters comment).

Concrete gating example in `views/board-view.tsx` (wrap the existing AddColumnForm usage):

```tsx
      {editable ? <AddColumnForm pageId={pageId} /> : null}
```

Concrete gating example in `views/board-column.tsx` (wrap the existing AddCardForm usage at line ~79):

```tsx
      {editable ? <AddCardForm pageId={pageId} columnId={column.id} /> : null}
```

- [ ] **Step 5: Wire `editable` from PageRenderer to the kanban branch**

In `apps/web/src/components/page/page-renderer.tsx`, update the KANBAN branch:

```tsx
  if (page.type === 'KANBAN') {
    return <KanbanBoardPage pageId={page.id} editable={editable} />
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run test/kanban-board-page-editable.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Type-check the web app**

Run: `pnpm --filter web check-types`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx \
        apps/web/src/components/kanban/kanban-board-page.tsx \
        apps/web/src/components/kanban/kanban-toolbar.tsx \
        apps/web/src/components/kanban/views/board-view.tsx \
        apps/web/src/components/kanban/views/table-view.tsx \
        apps/web/src/components/kanban/views/gantt-view.tsx \
        apps/web/src/components/kanban/views/board-column.tsx \
        apps/web/src/components/kanban/task/task-detail-container.tsx \
        apps/web/test/kanban-board-page-editable.test.tsx
git commit -m "feat(web): thread editable into kanban client to hide edit affordances for commenters"
```

---

## Section C — Share render verification (E2E)

### Task C1: E2E — every page type opens via a share link (member path)

**Files:**
- Test: `apps/e2e/share-page-types.spec.ts`

This is a smoke test. Following `page-sharing.spec.ts`, the cheapest reliable approach is to seed pages + a PUBLIC PageShare directly via Prisma (avoiding the full UI create flow per type), then open `/s/{shareId}` and assert the renderer mounts. Use the existing `signUpAndAuthAs` only if a session is needed; for PUBLIC links anonymous context suffices.

- [ ] **Step 1: Write the spec (seed via Prisma, open each share)**

Create `apps/e2e/share-page-types.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs, writeConsentsForUserId } from './helpers/auth'

const password = 'SuperSecure123!'

// Types that have a renderer and can be smoke-opened with empty content.
const TYPES = ['TEXT', 'EXCALIDRAW', 'GENOGRAM', 'MERMAID', 'PLANTUML', 'LIKEC4', 'DRAWIO'] as const

test('each shareable page type renders via a public share link', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const email = `sharetypes+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })

  await page.getByRole('textbox', { name: 'Название' }).fill('Types WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/([a-f0-9-]+)\/chats/, { timeout: 30_000 })
  const workspaceId = /\/workspaces\/([a-f0-9-]+)\//.exec(page.url())?.[1]
  expect(workspaceId).toBeTruthy()

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')

  const me = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  for (const type of TYPES) {
    const created = await prisma.page.create({
      data: {
        workspaceId: workspaceId!,
        type: type as never,
        title: `${type} page`,
        createdById: me.id,
      },
      select: { id: true },
    })
    const shareId = await import('node:crypto').then((c) => c.randomBytes(32).toString('hex'))
    await prisma.pageShare.create({
      data: {
        pageId: created.id,
        shareId,
        access: 'PUBLIC',
        linkRole: 'READER',
        createdById: me.id,
      },
    })

    const anon = await browser.newContext()
    const anonPage = await anon.newPage()
    await anonPage.goto(`http://localhost:3100/s/${shareId}`)
    // Share chrome proves the route resolved and the renderer mounted (no 404, no "not supported").
    await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 30_000 })
    await expect(
      anonPage.getByText(/пока не поддерживается/),
    ).toHaveCount(0)
    await anon.close()
  }
})
```

> Note: `writeConsentsForUserId` import is included in case `signUpAndAuthAs` doesn't already write consents; if the helper already does (it marks emailVerified and writes consents per project memory), drop the unused import to satisfy lint. Verify against `apps/e2e/helpers/auth.ts`.

- [ ] **Step 2: Ensure infra is up and run the spec**

Run: `docker compose up -d` (postgres/minio/qdrant must be up).
Run: `pnpm exec playwright test apps/e2e/share-page-types.spec.ts --retries=1`
Expected: PASS. The `--retries=1` warms the cold dev-compile on attempt 1 per project memory.

> If a board type shows an infinite spinner instead of share chrome (e.g. a yjs board that needs the yjs server, which Playwright's webServer does not run), the share chrome header ("Общий доступ") still renders because it's server-side in the share RSC — assert on that, not on board interactivity. KANBAN is intentionally excluded from this member-anonymous smoke (kanban-as-anonymous is Spec 2); KANBAN-as-member is covered by Section E unit/component tests.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/share-page-types.spec.ts
git commit -m "test(e2e): smoke that every shareable page type renders via a public link"
```

### Task C2: E2E — a commenter share link is read-only on a non-text board

**Files:**
- Test: `apps/e2e/share-commenter-readonly.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/e2e/share-commenter-readonly.spec.ts`. Seed a MERMAID page + PUBLIC share with `linkRole='COMMENTER'`, open as anonymous, and assert the read-only badge and that the Monaco source editor is read-only (no editing affordance). The most robust signal available server-side is the absence of the "Только просмотр" badge being wrong; since COMMENTER yields `editable=false`, the badge "Только просмотр" renders.

```typescript
import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test('a COMMENTER public link renders a non-text board read-only', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const email = `sharecomm+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })

  await page.getByRole('textbox', { name: 'Название' }).fill('Comm WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/([a-f0-9-]+)\/chats/, { timeout: 30_000 })
  const workspaceId = /\/workspaces\/([a-f0-9-]+)\//.exec(page.url())?.[1]

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  const me = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  const created = await prisma.page.create({
    data: { workspaceId: workspaceId!, type: 'MERMAID' as never, title: 'Diagram', createdById: me.id },
    select: { id: true },
  })
  const shareId = await import('node:crypto').then((c) => c.randomBytes(32).toString('hex'))
  await prisma.pageShare.create({
    data: { pageId: created.id, shareId, access: 'PUBLIC', linkRole: 'COMMENTER', createdById: me.id },
  })

  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto(`http://localhost:3100/s/${shareId}`)

  await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 30_000 })
  await expect(anonPage.getByText('Только просмотр')).toBeVisible()
  await anon.close()
})
```

> Note: "Только просмотр" renders whenever `!editable`; for COMMENTER, `editable = role === 'EDITOR' || role === 'OWNER'` is false, so the badge appears. This proves the commenter gets a non-editable view at the share-route level. Deeper board-internal read-only assertions are covered by the unit test in Task D1.

- [ ] **Step 2: Run the spec**

Run: `pnpm exec playwright test apps/e2e/share-commenter-readonly.spec.ts --retries=1`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/share-commenter-readonly.spec.ts
git commit -m "test(e2e): COMMENTER public link renders a non-text board read-only"
```

---

## Final verification

### Task F1: Run the full gate

- [ ] **Step 1: Run gates from repo root**

Run: `pnpm gates`
Expected: check-types + lint (--max-warnings 0) + build + test all green. Fix any lint (unused imports — especially the icon imports in B2 and the optional E2E imports in C) or type errors surfaced.

- [ ] **Step 2: Targeted unit suites**

Run:
```bash
pnpm --filter web exec vitest run test/workspace-section-switcher.test.tsx test/workspace-settings-nav.test.tsx test/page-renderer-editable.test.tsx test/kanban-board-page-editable.test.tsx
pnpm --filter @repo/domain exec vitest run test/kanban/service.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "chore: gate fixups for plan-gating + share permissions"
```

---

## Notes / Out of scope (Spec 2)

- Anonymous/non-member kanban share (share-token transport into kanban tRPC context, share-role-aware authorization reaching `assertCanEdit` for guests, anonymous `TaskComment` authorship + schema migration, share-scoped kanban realtime). Spec-1's `assertCanEdit`/`assertCanComment` are intentionally designed so Spec 2 can feed a share-derived role through the same guards.
- DATABASE / FORM renderers (do not exist in-app).
- DrawIO read-only enforcement inside the iframe (no toggle wired; Yjs server still rejects writes).
