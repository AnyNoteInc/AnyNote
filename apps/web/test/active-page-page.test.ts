import { TRPCError } from '@trpc/server'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerTRPC: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  requireSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))

vi.mock('@/trpc/server', () => ({
  getServerTRPC: mocks.getServerTRPC,
}))

vi.mock('@/lib/get-session', () => ({
  requireSession: mocks.requireSession,
}))

vi.mock('@/components/page/page-renderer', () => ({
  PageRenderer: () => null,
}))

vi.mock('@/components/page/page-header', () => ({
  PageHeader: () => null,
}))

import PageRoute from '../src/app/(protected)/(active)/pages/[pageId]/page'

const WS = '11111111-1111-4111-9111-111111111111'
const WS2 = '33333333-3333-4333-9333-333333333333'
const PAGE_ID = '22222222-2222-4222-9222-222222222222'

const PAGE = {
  id: PAGE_ID,
  workspaceId: WS,
  type: 'TEXT' as const,
  title: 'Demo',
  icon: null,
  contentYjs: null,
}

describe('neutral page route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('React', React)
    mocks.requireSession.mockResolvedValue({
      user: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@b.dev' },
    })
  })

  it('renders the page when the active workspace already matches the page', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      page: { getById: vi.fn().mockResolvedValue(PAGE) },
      workspace: {
        getActive: vi.fn().mockResolvedValue({ id: WS }),
        setActive: vi.fn(),
      },
    })

    const element = await PageRoute({ params: Promise.resolve({ pageId: PAGE_ID }) })

    expect(element).toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('switches the active workspace and redirects when the page lives elsewhere', async () => {
    const setActive = vi.fn()
    mocks.getServerTRPC.mockResolvedValue({
      page: { getById: vi.fn().mockResolvedValue({ ...PAGE, workspaceId: WS2 }) },
      workspace: {
        getActive: vi.fn().mockResolvedValue({ id: WS }),
        setActive,
      },
    })

    await expect(PageRoute({ params: Promise.resolve({ pageId: PAGE_ID }) })).rejects.toThrow(
      `NEXT_REDIRECT:/pages/${PAGE_ID}`,
    )

    expect(setActive).toHaveBeenCalledWith({ workspaceId: WS2 })
    expect(mocks.redirect).toHaveBeenCalledWith(`/pages/${PAGE_ID}`)
  })

  it('calls notFound when getById throws NOT_FOUND', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      page: {
        getById: vi.fn().mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' })),
      },
      workspace: { getActive: vi.fn(), setActive: vi.fn() },
    })

    await expect(PageRoute({ params: Promise.resolve({ pageId: PAGE_ID }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-NOT_FOUND errors instead of masking them as 404', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      page: { getById: vi.fn().mockRejectedValue(new Error('boom')) },
      workspace: { getActive: vi.fn(), setActive: vi.fn() },
    })

    await expect(PageRoute({ params: Promise.resolve({ pageId: PAGE_ID }) })).rejects.toThrow(
      'boom',
    )

    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})
