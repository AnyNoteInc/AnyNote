import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  canCreate: vi.fn(),
  getActive: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('@/trpc/server', () => ({
  getServerTRPC: vi.fn(async () => ({
    workspace: { canCreate: mocks.canCreate, getActive: mocks.getActive },
  })),
}))

// The form is a client component pulling MUI/tRPC-react; stub it so the server
// page renders without that subtree under the node test env.
vi.mock('@/components/workspace/new-workspace-form', () => ({
  NewWorkspaceForm: () => null,
}))

import NewWorkspacePage from '../src/app/(protected)/workspaces/new/page'

describe('/workspaces/new page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects a plan-maxed user with an existing workspace into /app', async () => {
    mocks.canCreate.mockResolvedValue({ allowed: false, owned: 3, maxWorkspaces: 3 })
    mocks.getActive.mockResolvedValue({ id: 'workspace-1' })

    await expect(NewWorkspacePage()).rejects.toThrow('NEXT_REDIRECT:/app')
    expect(mocks.redirect).toHaveBeenCalledWith('/app')
  })

  it('renders the form when the user can create a workspace', async () => {
    mocks.canCreate.mockResolvedValue({ allowed: true, owned: 1, maxWorkspaces: 3 })
    mocks.getActive.mockResolvedValue({ id: 'workspace-1' })

    await expect(NewWorkspacePage()).resolves.toBeTruthy()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders the form when the user is maxed but has NO workspace (cannot be redirected into one)', async () => {
    mocks.canCreate.mockResolvedValue({ allowed: false, owned: 3, maxWorkspaces: 3 })
    mocks.getActive.mockResolvedValue(null)

    await expect(NewWorkspacePage()).resolves.toBeTruthy()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders the form (never redirects) when the gate read fails', async () => {
    mocks.canCreate.mockRejectedValue(new Error('no active subscription'))
    mocks.getActive.mockResolvedValue({ id: 'workspace-1' })

    await expect(NewWorkspacePage()).resolves.toBeTruthy()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
