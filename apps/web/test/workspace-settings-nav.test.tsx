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
