import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { createDomain } from '../src/container.ts'

function makePrisma() {
  return {
    workspaceMember: {
      findUnique: vi.fn(async () => ({ workspaceId: 'w1', userId: 'u1', role: 'MEMBER' })),
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
})
