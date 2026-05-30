import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { createDomain } from '../src/container.ts'
import type { DeliveryScheduler } from '../src/reminders/reminders.ports.ts'

function makeScheduler(): DeliveryScheduler {
  return { rebuild: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
}

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
    const domain = createDomain({ prisma: makePrisma(), scheduler: makeScheduler() })
    expect(domain.workspace).toBeDefined()
    expect(typeof domain.workspace.assertMembership).toBe('function')
  })

  it('the resolved service performs a real membership check end-to-end', async () => {
    const domain = createDomain({ prisma: makePrisma(), scheduler: makeScheduler() })
    await expect(domain.workspace.assertMembership('u1', 'w1')).resolves.toEqual({
      workspaceId: 'w1',
      userId: 'u1',
      role: 'MEMBER',
    })
  })

  it('resolves the favorites service from the container', () => {
    const domain = createDomain({ prisma: makePrisma(), scheduler: makeScheduler() })
    expect(domain.favorites).toBeDefined()
    expect(typeof domain.favorites.add).toBe('function')
    expect(typeof domain.favorites.remove).toBe('function')
    expect(typeof domain.favorites.reorder).toBe('function')
  })

  it('resolves the notifications service from the container', () => {
    const domain = createDomain({ prisma: makePrisma(), scheduler: makeScheduler() })
    expect(domain.notifications).toBeDefined()
    expect(typeof domain.notifications.markRead).toBe('function')
    expect(typeof domain.notifications.markAllRead).toBe('function')
    expect(typeof domain.notifications.deleteAll).toBe('function')
  })

  it('resolves the reminders service from the container', () => {
    const domain = createDomain({ prisma: makePrisma(), scheduler: makeScheduler() })
    expect(domain.reminders).toBeDefined()
    expect(typeof domain.reminders.create).toBe('function')
    expect(typeof domain.reminders.move).toBe('function')
    expect(typeof domain.reminders.remove).toBe('function')
    expect(typeof domain.reminders.complete).toBe('function')
    expect(typeof domain.reminders.sync).toBe('function')
  })

  it('resolves the kanban service from the container', () => {
    const domain = createDomain({ prisma: makePrisma(), scheduler: makeScheduler() })
    expect(domain.kanban).toBeDefined()
    expect(typeof domain.kanban.createTask).toBe('function')
    expect(typeof domain.kanban.updateTask).toBe('function')
    expect(typeof domain.kanban.moveTask).toBe('function')
    expect(typeof domain.kanban.setTaskAssignees).toBe('function')
    expect(typeof domain.kanban.archiveTask).toBe('function')
    expect(typeof domain.kanban.createSprint).toBe('function')
    expect(typeof domain.kanban.activateSprint).toBe('function')
    expect(typeof domain.kanban.completeSprint).toBe('function')
    expect(typeof domain.kanban.createTaskComment).toBe('function')
    expect(typeof domain.kanban.seedDefaults).toBe('function')
  })

  it('resolves the pages service from the container', () => {
    const domain = createDomain({ prisma: makePrisma(), scheduler: makeScheduler() })
    expect(domain.pages).toBeDefined()
    expect(typeof domain.pages.create).toBe('function')
    expect(typeof domain.pages.rename).toBe('function')
    expect(typeof domain.pages.update).toBe('function')
    expect(typeof domain.pages.duplicate).toBe('function')
    expect(typeof domain.pages.move).toBe('function')
    expect(typeof domain.pages.reorder).toBe('function')
    expect(typeof domain.pages.softDelete).toBe('function')
    expect(typeof domain.pages.restore).toBe('function')
    expect(typeof domain.pages.hardDelete).toBe('function')
    expect(typeof domain.pages.emptyTrash).toBe('function')
  })
})
