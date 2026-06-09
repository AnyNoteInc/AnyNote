import { describe, expect, it, vi } from 'vitest'

const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }))
vi.mock('../src/emit.ts', () => ({ emit: emitMock }))

import {
  DEDUP_WINDOW_MS,
  notifyPageActivity,
  resolvePageActivityRecipients,
  shouldDedup,
} from '../src/page-activity.ts'

const PAGE = 'page-1'
const ACTOR = 'actor-1'

describe('resolvePageActivityRecipients', () => {
  function makePrisma(rows: { userId: string; level: string }[]) {
    return {
      pageNotificationPreference: {
        findMany: vi.fn(async ({ where }: { where: { level: { in: string[] } } }) =>
          rows
            .filter((r) => where.level.in.includes(r.level))
            .map((r) => ({ userId: r.userId })),
        ),
      },
    } as never
  }

  it('comment kind includes ALL_COMMENTS and ALL_UPDATES prefs, excludes the actor', async () => {
    const prisma = makePrisma([
      { userId: 'u1', level: 'ALL_COMMENTS' },
      { userId: 'u2', level: 'ALL_UPDATES' },
      { userId: 'u3', level: 'REPLIES_AND_MENTIONS' },
      { userId: ACTOR, level: 'ALL_COMMENTS' },
    ])
    const out = await resolvePageActivityRecipients(prisma, {
      pageId: PAGE,
      kind: 'comment',
      actorId: ACTOR,
    })
    expect(out.sort()).toEqual(['u1', 'u2'])
  })

  it('database_update kind includes only ALL_UPDATES', async () => {
    const prisma = makePrisma([
      { userId: 'u1', level: 'ALL_UPDATES' },
      { userId: 'u2', level: 'IMPORTANT_UPDATES' },
    ])
    const out = await resolvePageActivityRecipients(prisma, {
      pageId: PAGE,
      kind: 'database_update',
    })
    expect(out).toEqual(['u1'])
  })

  it('database_important kind includes ALL_UPDATES and IMPORTANT_UPDATES', async () => {
    const prisma = makePrisma([
      { userId: 'u1', level: 'ALL_UPDATES' },
      { userId: 'u2', level: 'IMPORTANT_UPDATES' },
      { userId: 'u3', level: 'ALL_COMMENTS' },
    ])
    const out = await resolvePageActivityRecipients(prisma, {
      pageId: PAGE,
      kind: 'database_important',
    })
    expect(out.sort()).toEqual(['u1', 'u2'])
  })

  it('returns distinct userIds (a user with one row appears once)', async () => {
    const prisma = makePrisma([{ userId: 'u1', level: 'ALL_UPDATES' }])
    const out = await resolvePageActivityRecipients(prisma, {
      pageId: PAGE,
      kind: 'comment',
    })
    expect(out).toEqual(['u1'])
  })
})

describe('shouldDedup', () => {
  it('true when an unread same-key in-app event exists within the window', async () => {
    const findFirst = vi.fn(async () => ({ id: 'inapp-1' }))
    const prisma = { notificationInApp: { findFirst } } as never
    const res = await shouldDedup(prisma, {
      userId: 'u1',
      pageId: PAGE,
      actorId: ACTOR,
      type: 'DATABASE_UPDATE',
    })
    expect(res).toBe(true)
    // Query filters on unread + within the window + payload pageId/actorId.
    const where = findFirst.mock.calls[0]![0].where
    expect(where.userId).toBe('u1')
    expect(where.readAt).toBeNull()
    expect(where.createdAt.gte).toBeInstanceOf(Date)
    expect(where.event.type).toBe('DATABASE_UPDATE')
    const ms = Date.now() - (where.createdAt.gte as Date).getTime()
    expect(ms).toBeGreaterThanOrEqual(DEDUP_WINDOW_MS - 1000)
    expect(ms).toBeLessThanOrEqual(DEDUP_WINDOW_MS + 1000)
  })

  it('false when no matching unread event exists', async () => {
    const prisma = { notificationInApp: { findFirst: vi.fn(async () => null) } } as never
    const res = await shouldDedup(prisma, {
      userId: 'u1',
      pageId: PAGE,
      actorId: ACTOR,
      type: 'DATABASE_UPDATE',
    })
    expect(res).toBe(false)
  })
})

describe('notifyPageActivity', () => {
  function makePrisma(deduped: boolean) {
    return {
      notificationInApp: { findFirst: vi.fn(async () => (deduped ? { id: 'x' } : null)) },
    } as never
  }

  it('database_update is deduped away when a recent unread same-key event exists', async () => {
    emitMock.mockClear()
    await notifyPageActivity(makePrisma(true), {
      kind: 'database_update',
      recipients: ['u1'],
      payload: { workspaceId: 'w1', pageId: PAGE, actorId: ACTOR, actorName: 'A', rowId: 'r1', propertyId: 'p1', label: 'Статус' },
    })
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('database_update emits when not deduped', async () => {
    emitMock.mockClear()
    await notifyPageActivity(makePrisma(false), {
      kind: 'database_update',
      recipients: ['u1'],
      payload: { workspaceId: 'w1', pageId: PAGE, actorId: ACTOR, actorName: 'A', rowId: 'r1', propertyId: 'p1', label: 'Статус' },
    })
    expect(emitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'DATABASE_UPDATE', userId: 'u1' }),
    )
  })

  it('comment_reply BYPASSES dedup (a direct reply is never collapsed)', async () => {
    emitMock.mockClear()
    const prisma = makePrisma(true) // dedup would say "skip" if it were consulted
    await notifyPageActivity(prisma, {
      kind: 'comment_reply',
      recipients: ['u1'],
      payload: { workspaceId: 'w1', pageId: PAGE, threadId: 't1', commentId: 'c1', actorId: ACTOR, actorName: 'A', snippet: 'hi' },
    })
    expect(emitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'COMMENT_REPLY', userId: 'u1' }),
    )
    expect(prisma.notificationInApp.findFirst).not.toHaveBeenCalled()
  })

  it('database_person_assigned BYPASSES dedup', async () => {
    emitMock.mockClear()
    const prisma = makePrisma(true)
    await notifyPageActivity(prisma, {
      kind: 'database_person_assigned',
      recipients: ['u1'],
      payload: { workspaceId: 'w1', pageId: PAGE, rowId: 'r1', propertyId: 'p1', actorId: ACTOR, actorName: 'A', label: 'Исполнитель' },
    })
    expect(emitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'DATABASE_PERSON_ASSIGNED', userId: 'u1' }),
    )
    expect(prisma.notificationInApp.findFirst).not.toHaveBeenCalled()
  })

  it('never notifies the actor even if present in recipients', async () => {
    emitMock.mockClear()
    await notifyPageActivity(makePrisma(false), {
      kind: 'database_update',
      recipients: [ACTOR],
      payload: { workspaceId: 'w1', pageId: PAGE, actorId: ACTOR, actorName: 'A', rowId: 'r1', propertyId: 'p1', label: 'x' },
    })
    expect(emitMock).not.toHaveBeenCalled()
  })
})
