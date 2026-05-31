import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  listByWorkspace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

// getServerTRPC builds a request-scoped tRPC context (headers/session), which
// is unavailable under Vitest's node env. Mock it so the page can resolve its
// page list without touching `headers()`.
vi.mock('@/trpc/server', () => ({
  getServerTRPC: vi.fn(async () => ({
    page: { listByWorkspace: mocks.listByWorkspace },
  })),
}))

import WorkspaceRootPage from '../src/app/(protected)/workspaces/[workspaceId]/page'

describe('workspace root page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to the new-chat entry point when the workspace has no pages', async () => {
    mocks.listByWorkspace.mockResolvedValue([])

    await expect(
      WorkspaceRootPage({
        params: Promise.resolve({ workspaceId: 'workspace-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/workspaces/workspace-1/chats/new')

    expect(mocks.redirect).toHaveBeenCalledWith('/workspaces/workspace-1/chats/new')
  })

  it('redirects to the first page in tree order when the workspace has pages', async () => {
    mocks.listByWorkspace.mockResolvedValue([
      {
        id: 'page-a',
        title: 'A',
        icon: null,
        parentId: null,
        prevPageId: null,
        createdById: null,
        createdAt: new Date(0),
      },
    ])

    await expect(
      WorkspaceRootPage({
        params: Promise.resolve({ workspaceId: 'workspace-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/workspaces/workspace-1/pages/page-a')

    expect(mocks.redirect).toHaveBeenCalledWith('/workspaces/workspace-1/pages/page-a')
  })
})
