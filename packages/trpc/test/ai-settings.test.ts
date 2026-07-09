import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@repo/db')>()),
  prisma: {},
}))

import type { PrismaClient } from '@repo/db'
import { aiSettingsRouter } from '../src/routers/ai-settings'
import { createCallerFactory } from '../src/trpc'

const WS = '00000000-0000-4000-8000-000000000001'
const caller = createCallerFactory(aiSettingsRouter)

function ctx(role: string | null) {
  const prisma = { workspaceMember: { findUnique: vi.fn().mockResolvedValue(role ? { role } : null) } }
  return {
    prisma: prisma as unknown as PrismaClient,
    user: { id: 'u1' },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

describe('aiSettings.update owner gate', () => {
  it('forbids a non-owner member', async () => {
    await expect(caller(ctx('EDITOR')).update({ workspaceId: WS, systemPrompt: 'x' })).rejects.toThrow(/прав/)
  })

  it('forbids a non-member', async () => {
    await expect(caller(ctx(null)).update({ workspaceId: WS, systemPrompt: 'x' })).rejects.toThrow(/прав/)
  })
})
