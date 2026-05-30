import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

// Mock the domain singleton: the router calls domainSvc.reminders.sync(userId, input).
// The scheduler, prisma wiring, and all sync internals live inside @repo/domain and are
// tested there. This test owns: correct argument forwarding, return value pass-through,
// and mapDomain error translation (FORBIDDEN / BAD_REQUEST → TRPCError).
const reminderMocks = vi.hoisted(() => ({
  sync: vi.fn(async () => ({ ok: true as const })),
}))
vi.mock('../src/domain', () => ({
  domain: { reminders: { sync: reminderMocks.sync } },
}))

import { reminderRouter } from '../src/routers/reminder'
import { createCallerFactory } from '../src/trpc'
import { DomainError } from '@repo/domain'
import type { PrismaClient } from '@repo/db'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const REMINDER_ID = '00000000-0000-0000-0000-000000000004'

function ctx(prisma: PrismaClient = {} as PrismaClient, userId = USER_ID) {
  return {
    prisma,
    user: {
      id: userId,
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

function makeReminder(
  overrides: Partial<{
    id: string
    dueAt: string
    label: string | null
    audience: 'ME' | 'WORKSPACE' | 'LIST'
    recipients: string[]
  }> = {},
) {
  return {
    id: overrides.id ?? REMINDER_ID,
    dueAt: overrides.dueAt ?? new Date(Date.now() + 86_400_000).toISOString(),
    offsets: [0],
    audience: overrides.audience ?? ('ME' as const),
    label: overrides.label ?? 'Test reminder',
    recipients: overrides.recipients ?? [],
    doneAt: null,
  }
}

describe('reminder.syncForPage — happy path', () => {
  it('delegates to domainSvc.reminders.sync with correct userId and input, returns { ok: true }', async () => {
    reminderMocks.sync.mockResolvedValueOnce({ ok: true })
    const caller = createCallerFactory(reminderRouter)(ctx())
    const input = { pageId: PAGE_ID, reminders: [makeReminder()] }

    const result = await caller.syncForPage(input)

    expect(result).toEqual({ ok: true })
    expect(reminderMocks.sync).toHaveBeenCalledOnce()
    expect(reminderMocks.sync).toHaveBeenCalledWith(USER_ID, input)
  })
})

describe('reminder.syncForPage — mapDomain translates FORBIDDEN domain error', () => {
  it('throws TRPCError FORBIDDEN when domain throws a 403 DomainError (e.g. VIEWER role)', async () => {
    // The domain rejects callers without write access; mapDomain translates the 403.
    reminderMocks.sync.mockRejectedValueOnce(new DomainError('FORBIDDEN', 'Недостаточно прав', 403))
    const caller = createCallerFactory(reminderRouter)(ctx())

    await expect(
      caller.syncForPage({ pageId: PAGE_ID, reminders: [makeReminder()] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('reminder.syncForPage — mapDomain translates BAD_REQUEST domain error', () => {
  it('throws TRPCError BAD_REQUEST when domain throws a 400 DomainError (e.g. non-member recipient)', async () => {
    // The domain validates that LIST recipients are workspace members; mapDomain translates the 400.
    reminderMocks.sync.mockRejectedValueOnce(
      new DomainError('BAD_REQUEST', 'Some recipients are not workspace members', 400),
    )
    const caller = createCallerFactory(reminderRouter)(ctx())

    await expect(
      caller.syncForPage({
        pageId: PAGE_ID,
        reminders: [makeReminder({ audience: 'LIST', recipients: ['00000000-0000-0000-0000-000000000099'] })],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
