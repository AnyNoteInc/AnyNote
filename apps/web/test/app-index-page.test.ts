import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  getActive: vi.fn(),
  listByWorkspace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

// getServerTRPC builds a request-scoped tRPC context (headers/session), which
// is unavailable under Vitest's node env. Mock it so the page can resolve the
// active workspace and its page list without touching `headers()`.
vi.mock('@/trpc/server', () => ({
  getServerTRPC: vi.fn(async () => ({
    workspace: { getActive: mocks.getActive },
    page: { listByWorkspace: mocks.listByWorkspace },
  })),
}))

import AppIndexPage from '../src/app/(protected)/app/page'

describe('/app index page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to the new-chat entry point when the active workspace has no pages', async () => {
    mocks.getActive.mockResolvedValue({ id: 'workspace-1' })
    mocks.listByWorkspace.mockResolvedValue([])

    await expect(AppIndexPage()).rejects.toThrow('NEXT_REDIRECT:/chats/new')

    expect(mocks.listByWorkspace).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(mocks.redirect).toHaveBeenCalledWith('/chats/new')
  })

  it('redirects to the first page in tree order when the active workspace has pages', async () => {
    mocks.getActive.mockResolvedValue({ id: 'workspace-1' })
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

    await expect(AppIndexPage()).rejects.toThrow('NEXT_REDIRECT:/pages/page-a')

    expect(mocks.redirect).toHaveBeenCalledWith('/pages/page-a')
  })

  it('redirects to /workspaces/new when there is no active workspace', async () => {
    mocks.getActive.mockResolvedValue(null)

    await expect(AppIndexPage()).rejects.toThrow('NEXT_REDIRECT:/workspaces/new')

    expect(mocks.redirect).toHaveBeenCalledWith('/workspaces/new')
    expect(mocks.listByWorkspace).not.toHaveBeenCalled()
  })
})
