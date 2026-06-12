import { describe, expect, it, vi } from 'vitest'

const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }))
vi.mock('../src/emit.ts', () => ({ emit: emitMock }))

import { notify } from '../src/helpers.ts'

describe('notify helpers', () => {
  it('workspaceInvite forwards correct args to emit', async () => {
    emitMock.mockClear()
    const prisma = {} as never
    await notify.workspaceInvite(prisma, {
      userId: 'u1',
      workspaceId: 'w1',
      actorId: 'u2',
      inviterName: 'Anna',
      workspaceName: 'Marketing',
      firstName: 'Bob',
      link: 'https://x/inv/abc',
    })
    expect(emitMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'WORKSPACE_INVITE',
        userId: 'u1',
        workspaceId: 'w1',
        resourceUrl: '/workspaces/w1',
      }),
    )
  })

  it('guestInviteRequested targets the owner with the settings deep link', async () => {
    emitMock.mockClear()
    const prisma = {} as never
    await notify.guestInviteRequested(prisma, {
      userId: 'owner-1',
      workspaceId: 'w1',
      actorId: 'member-1',
      requesterName: 'Anna',
      pageTitle: 'Roadmap',
      workspaceName: 'Marketing',
      link: '/workspaces/w1/settings',
    })
    expect(emitMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'GUEST_INVITE_REQUESTED',
        userId: 'owner-1',
        workspaceId: 'w1',
        actorId: 'member-1',
        resourceUrl: '/workspaces/w1/settings',
        payload: expect.objectContaining({
          requesterName: 'Anna',
          pageTitle: 'Roadmap',
          workspaceName: 'Marketing',
        }),
      }),
    )
  })

  it('verifyEmail builds correct payload', async () => {
    emitMock.mockClear()
    const prisma = {} as never
    await notify.verifyEmail(prisma, {
      userId: 'u1',
      firstName: 'A',
      link: 'l',
      expiresAtIso: '2026-01-01T00:00:00Z',
    })
    expect(emitMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ type: 'VERIFY_EMAIL', userId: 'u1' }),
    )
  })

  it('roleChanged sets resourceUrl to workspace settings', async () => {
    emitMock.mockClear()
    const prisma = {} as never
    await notify.roleChanged(prisma, {
      userId: 'u1',
      workspaceId: 'w1',
      newRole: 'EDITOR',
      workspaceName: 'X',
    })
    expect(emitMock.mock.calls[0][1]).toMatchObject({
      type: 'ROLE_CHANGED',
      resourceUrl: '/workspaces/w1/settings',
    })
  })
})
