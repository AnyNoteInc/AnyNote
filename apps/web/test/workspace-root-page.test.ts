import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  getById: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

// getServerTRPC builds a request-scoped tRPC context (headers/session), which
// is unavailable under Vitest's node env. Mock it so the legacy redirect can
// resolve the workspace without touching `headers()`.
vi.mock('@/trpc/server', () => ({
  getServerTRPC: vi.fn(async () => ({
    workspace: { getById: mocks.getById, setActive: mocks.setActive },
  })),
}))

import LegacyWorkspaceRoot from '../src/app/(protected)/workspaces/[workspaceId]/page'

describe('legacy workspace root redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets the workspace active and redirects to /app when the workspace exists', async () => {
    mocks.getById.mockResolvedValue({ id: 'workspace-1' })

    await expect(
      LegacyWorkspaceRoot({
        params: Promise.resolve({ workspaceId: 'workspace-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/app')

    expect(mocks.getById).toHaveBeenCalledWith({ id: 'workspace-1' })
    expect(mocks.setActive).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(mocks.redirect).toHaveBeenCalledWith('/app')
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('calls notFound when the workspace does not exist', async () => {
    mocks.getById.mockResolvedValue(null)

    await expect(
      LegacyWorkspaceRoot({
        params: Promise.resolve({ workspaceId: 'missing' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
    expect(mocks.setActive).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
