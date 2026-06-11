import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/auth')>()
  return { ...actual, getUserFromRequest: vi.fn() }
})

vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'
import { agentMemoryRouter } from '../src/routers/agent-memory'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '22222222-2222-2222-2222-222222222222'
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333'
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
const ROW_ID = '44444444-4444-4444-4444-444444444444'

function baseContext(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

describe('agentMemory.list', () => {
  it('returns rows where scope=WORKSPACE OR (scope=USER AND userId=current)', async () => {
    const prismaMock = {
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR', userId: USER_ID, workspaceId: WORKSPACE_ID }),
      },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      workspaceAgentMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'a', workspaceId: WORKSPACE_ID, scope: 'WORKSPACE', userId: null, key: 'tone', content: 'formal', source: 'AGENT', createdAt: new Date(), updatedAt: new Date() },
          { id: 'b', workspaceId: WORKSPACE_ID, scope: 'USER', userId: USER_ID, key: 'lang', content: 'ru', source: 'AGENT', createdAt: new Date(), updatedAt: new Date() },
        ]),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(agentMemoryRouter)(baseContext(prismaMock))
    const rows = await caller.list({ workspaceId: WORKSPACE_ID })

    expect(rows.map((r) => r.key).sort()).toEqual(['lang', 'tone'])
    const findMany = vi.mocked(prismaMock.workspaceAgentMemory.findMany)
    const callArgs = findMany.mock.calls[0][0]
    expect(callArgs.where.workspaceId).toBe(WORKSPACE_ID)
    expect(callArgs.where.OR).toEqual([
      { scope: 'WORKSPACE' },
      { scope: 'USER', userId: USER_ID },
    ])
  })

  it('rejects non-member', async () => {
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      workspaceAgentMemory: { findMany: vi.fn() },
    } as unknown as PrismaClient

    const caller = createCallerFactory(agentMemoryRouter)(baseContext(prismaMock))
    await expect(caller.list({ workspaceId: WORKSPACE_ID })).rejects.toThrow(/Недостаточно прав|FORBIDDEN/i)
  })
})

describe('agentMemory.delete', () => {
  it('allows the author of a USER-scope row to delete it', async () => {
    const prismaMock = {
      workspaceAgentMemory: {
        findUnique: vi.fn().mockResolvedValue({
          id: ROW_ID,
          workspaceId: WORKSPACE_ID,
          scope: 'USER',
          userId: USER_ID,
          key: 'k',
          content: 'c',
          source: 'AGENT',
        }),
        delete: vi.fn().mockResolvedValue({ id: ROW_ID }),
      },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR', userId: USER_ID, workspaceId: WORKSPACE_ID }),
      },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(agentMemoryRouter)(baseContext(prismaMock))
    const out = await caller.delete({ id: ROW_ID })
    expect(out.ok).toBe(true)
    const deleteSpy = vi.mocked(prismaMock.workspaceAgentMemory.delete)
    expect(deleteSpy).toHaveBeenCalledWith({ where: { id: ROW_ID } })
  })

  it('allows workspace OWNER to delete a row authored by another user', async () => {
    const prismaMock = {
      workspaceAgentMemory: {
        findUnique: vi.fn().mockResolvedValue({
          id: ROW_ID,
          workspaceId: WORKSPACE_ID,
          scope: 'USER',
          userId: OTHER_USER_ID,
          key: 'k',
          content: 'c',
          source: 'AGENT',
        }),
        delete: vi.fn().mockResolvedValue({ id: ROW_ID }),
      },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({ role: 'OWNER', userId: USER_ID, workspaceId: WORKSPACE_ID }),
      },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(agentMemoryRouter)(baseContext(prismaMock))
    const out = await caller.delete({ id: ROW_ID })
    expect(out.ok).toBe(true)
  })

  it('rejects non-owner attempting to delete row owned by another user', async () => {
    const prismaMock = {
      workspaceAgentMemory: {
        findUnique: vi.fn().mockResolvedValue({
          id: ROW_ID,
          workspaceId: WORKSPACE_ID,
          scope: 'WORKSPACE',
          userId: null,
          key: 'k',
          content: 'c',
          source: 'AGENT',
        }),
        delete: vi.fn(),
      },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR', userId: USER_ID, workspaceId: WORKSPACE_ID }),
      },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(agentMemoryRouter)(baseContext(prismaMock))
    await expect(caller.delete({ id: ROW_ID })).rejects.toThrow(/FORBIDDEN|Недостаточно/i)
    const deleteSpy = vi.mocked(prismaMock.workspaceAgentMemory.delete)
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND for nonexistent row', async () => {
    const prismaMock = {
      workspaceAgentMemory: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(agentMemoryRouter)(baseContext(prismaMock))
    await expect(caller.delete({ id: ROW_ID })).rejects.toThrow(/NOT_FOUND/i)
  })
})
