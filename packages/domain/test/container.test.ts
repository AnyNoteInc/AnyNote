import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { createDomain } from '../src/container.ts'

function makePrisma() {
  return {
    workspaceMember: {
      findUnique: vi.fn(async () => ({ workspaceId: 'w1', userId: 'u1', role: 'MEMBER' })),
    },
    page: {
      findFirst: vi.fn(async () => null),
    },
    favoritePage: {
      aggregate: vi.fn(async () => ({ _max: { position: null } })),
      upsert: vi.fn(async () => ({ userId: 'u1', pageId: 'p1', position: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    notificationInApp: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  } as unknown as PrismaClient
}

describe('createDomain', () => {
  it('resolves the workspace service from the container', () => {
    const domain = createDomain({ prisma: makePrisma() })
    expect(domain.workspace).toBeDefined()
    expect(typeof domain.workspace.assertMembership).toBe('function')
  })

  it('the resolved service performs a real membership check end-to-end', async () => {
    const domain = createDomain({ prisma: makePrisma() })
    await expect(domain.workspace.assertMembership('u1', 'w1')).resolves.toEqual({
      workspaceId: 'w1',
      userId: 'u1',
      role: 'MEMBER',
    })
  })

  it('resolves the favorites service from the container', () => {
    const domain = createDomain({ prisma: makePrisma() })
    expect(domain.favorites).toBeDefined()
    expect(typeof domain.favorites.add).toBe('function')
    expect(typeof domain.favorites.remove).toBe('function')
    expect(typeof domain.favorites.reorder).toBe('function')
  })

  it('resolves the notifications service from the container', () => {
    const domain = createDomain({ prisma: makePrisma() })
    expect(domain.notifications).toBeDefined()
    expect(typeof domain.notifications.markRead).toBe('function')
    expect(typeof domain.notifications.markAllRead).toBe('function')
    expect(typeof domain.notifications.deleteAll).toBe('function')
  })
})
