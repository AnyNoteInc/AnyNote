import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

import WorkspaceRootPage from '../src/app/(protected)/workspaces/[workspaceId]/page'

describe('workspace root page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to the new-chat entry point', async () => {
    await expect(
      WorkspaceRootPage({
        params: Promise.resolve({ workspaceId: 'workspace-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/workspaces/workspace-1/chats/new')

    expect(mocks.redirect).toHaveBeenCalledWith('/workspaces/workspace-1/chats/new')
  })
})
