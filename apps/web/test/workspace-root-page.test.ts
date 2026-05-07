import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerTRPC: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('@/trpc/server', () => ({
  getServerTRPC: mocks.getServerTRPC,
}))

import WorkspaceRootPage from '../src/app/(protected)/workspaces/[workspaceId]/page'

describe('workspace root page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to the first root page in the visible page tree order', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      page: {
        listByWorkspace: vi.fn().mockResolvedValue([
          {
            id: 'later-root',
            title: 'Later root',
            icon: null,
            parentId: null,
            prevPageId: 'first-root',
            createdById: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            id: 'nested-oldest',
            title: 'Nested oldest',
            icon: null,
            parentId: 'later-root',
            prevPageId: null,
            createdById: null,
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
          },
          {
            id: 'first-root',
            title: 'First root',
            icon: null,
            parentId: null,
            prevPageId: null,
            createdById: null,
            createdAt: new Date('2026-01-03T00:00:00.000Z'),
          },
        ]),
      },
    })

    await expect(
      WorkspaceRootPage({
        params: Promise.resolve({ workspaceId: 'workspace-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/workspaces/workspace-1/pages/first-root')

    expect(mocks.redirect).toHaveBeenCalledWith('/workspaces/workspace-1/pages/first-root')
  })

  it('keeps the chats fallback when the workspace has no pages', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      page: {
        listByWorkspace: vi.fn().mockResolvedValue([]),
      },
    })

    await expect(
      WorkspaceRootPage({
        params: Promise.resolve({ workspaceId: 'workspace-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/workspaces/workspace-1/chats')

    expect(mocks.redirect).toHaveBeenCalledWith('/workspaces/workspace-1/chats')
  })
})
