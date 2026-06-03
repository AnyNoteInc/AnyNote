import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

const kanbanMocks = vi.hoisted(() => ({
  listParticipants: vi.fn(async () => [] as unknown[]),
  createParticipant: vi.fn(async () => ({ id: 'participant-1' })),
  updateParticipant: vi.fn(async () => ({ id: 'participant-1' })),
  deleteParticipant: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('../src/domain', () => ({ domain: { kanban: kanbanMocks } }))

import type { PrismaClient } from '@repo/db'

import { participantRouter } from '../src/routers/kanban/participant'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PARTICIPANT_ID = '00000000-0000-0000-0000-0000000000c1'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: {
      id: USER_ID,
      email: 't@e.com',
      firstName: 'T',
      lastName: 'U',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

describe('kanban.participant router', () => {
  it('list delegates to domainSvc.kanban.listParticipants with (userId, workspaceId)', async () => {
    kanbanMocks.listParticipants.mockResolvedValueOnce([{ id: 'participant-1' }])
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(participantRouter)(ctx(prisma))
    const result = await caller.list({ workspaceId: WORKSPACE_ID })

    expect(kanbanMocks.listParticipants).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID)
    expect(result).toEqual([{ id: 'participant-1' }])
  })

  it('create delegates to domainSvc.kanban.createParticipant with (userId, input)', async () => {
    kanbanMocks.createParticipant.mockResolvedValueOnce({ id: 'participant-9' })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(participantRouter)(ctx(prisma))
    const input = { workspaceId: WORKSPACE_ID, fullName: 'Ivan', company: 'Acme' }
    const result = await caller.create(input)

    expect(kanbanMocks.createParticipant).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining(input),
    )
    expect(result).toEqual({ id: 'participant-9' })
  })

  it('update delegates to domainSvc.kanban.updateParticipant with (userId, input)', async () => {
    kanbanMocks.updateParticipant.mockResolvedValueOnce({ id: PARTICIPANT_ID })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(participantRouter)(ctx(prisma))
    const input = { workspaceId: WORKSPACE_ID, id: PARTICIPANT_ID, fullName: 'Ivan II' }
    const result = await caller.update(input)

    expect(kanbanMocks.updateParticipant).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining(input),
    )
    expect(result).toEqual({ id: PARTICIPANT_ID })
  })

  it('delete delegates to domainSvc.kanban.deleteParticipant with (userId, input)', async () => {
    kanbanMocks.deleteParticipant.mockResolvedValueOnce({ ok: true as const })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(participantRouter)(ctx(prisma))
    const input = { workspaceId: WORKSPACE_ID, id: PARTICIPANT_ID }
    const result = await caller.delete(input)

    expect(kanbanMocks.deleteParticipant).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining(input),
    )
    expect(result.ok).toBe(true)
  })
})
