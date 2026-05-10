import { describe, expect, it, vi } from 'vitest'

const { sendMailNowMock, renderEmailMock } = vi.hoisted(() => ({
  sendMailNowMock: vi.fn(async () => undefined),
  renderEmailMock: vi.fn(() => ({
    kind: 'verify-email',
    data: { firstName: '', link: 'l', expiresAtIso: '2026-01-01T00:00:00Z' },
  })),
}))

vi.mock('@repo/mail', () => ({ sendMailNow: sendMailNowMock }))
vi.mock('../src/templates/registry.ts', () => ({ renderEmailForEvent: renderEmailMock }))

import { emit } from '../src/emit.ts'

type CreatedRows = {
  notificationEvent: Array<Record<string, unknown>>
  notificationInApp: Array<Record<string, unknown>>
  notificationDelivery: Array<Record<string, unknown>>
}

function makeTx(overrides?: { email?: string; pushSubs?: Array<{ id: string }> }) {
  const created: CreatedRows = {
    notificationEvent: [],
    notificationInApp: [],
    notificationDelivery: [],
  }
  const tx = {
    notificationEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.notificationEvent.push(data)
        return { id: 'evt1', ...data }
      }),
    },
    notificationInApp: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.notificationInApp.push(data)
        return data
      }),
    },
    notificationDelivery: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.notificationDelivery.push(data)
        return data
      }),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        email: overrides?.email ?? 'u@e.com',
        emailVerified: true,
      })),
    },
    notificationPreference: { findFirst: vi.fn(async () => null) },
    pushSubscription: { findMany: vi.fn(async () => overrides?.pushSubs ?? []) },
    userConsent: { findFirst: vi.fn(async () => null) },
  }
  return { tx, created }
}

function makePrisma(tx: ReturnType<typeof makeTx>['tx']) {
  return {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as never
}

describe('emit', () => {
  it('writes a NotificationEvent row with derived category', async () => {
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, {
      type: 'WORKSPACE_INVITE',
      userId: 'u1',
      workspaceId: 'w1',
      payload: { workspaceName: 'X' },
    })
    expect(created.notificationEvent).toHaveLength(1)
    expect(created.notificationEvent[0]).toMatchObject({
      type: 'WORKSPACE_INVITE',
      category: 'COLLABORATION',
    })
  })

  it('writes notification_in_app for events with IN_APP locked or default', async () => {
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, { type: 'WORKSPACE_INVITE', userId: 'u1', payload: {} })
    expect(created.notificationInApp).toHaveLength(1)
  })

  it('skips notification_in_app for SERVICE events (no IN_APP in catalog)', async () => {
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, {
      type: 'VERIFY_EMAIL',
      userId: 'u1',
      payload: { link: 'x', expiresAtIso: '2026-01-01T00:00:00Z' },
    })
    expect(created.notificationInApp).toHaveLength(0)
  })

  it('writes EMAIL delivery row for COLLABORATION when preferences enable it', async () => {
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, { type: 'WORKSPACE_INVITE', userId: 'u1', payload: {} })
    const emailDeliveries = created.notificationDelivery.filter(
      (d) => (d as { channel: string }).channel === 'EMAIL',
    )
    expect(emailDeliveries).toHaveLength(1)
  })

  it('SERVICE: calls sendMailNow synchronously and writes NO email delivery row', async () => {
    sendMailNowMock.mockClear()
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, {
      type: 'VERIFY_EMAIL',
      userId: 'u1',
      payload: { firstName: 'A', link: 'l', expiresAtIso: '2026-01-01T00:00:00Z' },
    })
    expect(sendMailNowMock).toHaveBeenCalledOnce()
    const emailDeliveries = created.notificationDelivery.filter(
      (d) => (d as { channel: string }).channel === 'EMAIL',
    )
    expect(emailDeliveries).toHaveLength(0)
  })

  it('writes one push delivery per subscription only when WEB_PUSH is in defaults', async () => {
    const { tx, created } = makeTx({ pushSubs: [{ id: 's1' }, { id: 's2' }] })
    const prisma = makePrisma(tx)
    await emit(prisma, { type: 'NEW_LOGIN', userId: 'u1', payload: {} })
    // NEW_LOGIN has IN_APP+EMAIL defaults, no WEB_PUSH.
    const pushDeliveries = created.notificationDelivery.filter(
      (d) => (d as { channel: string }).channel === 'WEB_PUSH',
    )
    expect(pushDeliveries).toHaveLength(0)
  })
})
