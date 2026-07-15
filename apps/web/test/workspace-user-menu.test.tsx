// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setPreference: vi.fn(),
  setTheme: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@repo/ui/providers', () => ({
  useThemeMode: () => ({
    mode: 'light',
    preference: 'system',
    setPreference: mocks.setPreference,
    toggleMode: vi.fn(),
  }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    user: {
      setTheme: {
        useMutation: () => ({
          mutate: mocks.setTheme,
        }),
      },
    },
  },
}))

import { WorkspaceUserMenu } from '@/components/workspace/workspace-user-menu'

const user = {
  firstName: 'Ivan',
  lastName: 'Petrov',
  email: 'ivan@example.com',
  image: null,
}

const features = {
  slug: 'personal',
  name: 'Персональный',
  sortOrder: 0,
  isPaid: false,
  maxWorkspaces: 1,
  maxMembersPerWorkspace: 1,
  chatsEnabled: true,
  pageIndexingEnabled: false,
  membersSettingsEnabled: false,
  aiSettingsEnabled: false,
  customMcpEnabled: false,
  customAiProvidersEnabled: false,
  prioritySupport: false,
  developerSpaceEnabled: false,
  publicSitesEnabled: false,
  meetingsEnabled: false,
  formConditionalLogicEnabled: false,
  formCustomSlugEnabled: false,
  formBrandingRemovalEnabled: false,
  pageHistoryDays: 7,
} as const

describe('WorkspaceUserMenu', () => {
  afterEach(() => {
    cleanup()
    document.cookie = 'theme=; Path=/; Max-Age=0'
    mocks.setPreference.mockClear()
    mocks.setTheme.mockClear()
  })

  it('shows theme controls after settings and stacks upgrade above logout', async () => {
    const actor = userEvent.setup()

    render(
      <WorkspaceUserMenu
        user={user}
        features={features}
        workspace={{ name: 'Моё пространство', icon: null }}
      />,
    )

    await actor.click(screen.getByText('Ivan Petrov'))

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Тема')).toBeInTheDocument()

    const themeGroup = within(menu).getByRole('group', { name: 'Тема' })
    expect(themeGroup).toHaveClass('MuiButtonGroup-root')
    expect(themeGroup).toHaveClass('MuiButtonGroup-text')
    expect(within(themeGroup).getByRole('button', { name: 'Системная тема' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(themeGroup).getByRole('button', { name: 'Светлая тема' })).toBeInTheDocument()
    expect(within(themeGroup).getByRole('button', { name: 'Тёмная тема' })).toBeInTheDocument()

    const actions = within(menu).getByTestId('workspace-user-menu-actions')
    expect(within(actions).getByText('Обновить план')).toBeInTheDocument()
    expect(within(actions).getByText('Выйти')).toBeInTheDocument()
    expect(within(actions).getByRole('separator')).not.toHaveAttribute(
      'aria-orientation',
      'vertical',
    )

    await actor.click(within(themeGroup).getByRole('button', { name: 'Тёмная тема' }))

    expect(mocks.setPreference).toHaveBeenCalledWith('dark')
    expect(mocks.setTheme).toHaveBeenCalledWith({ theme: 'dark' })
    expect(document.cookie).toContain('theme=dark')
  })
})
