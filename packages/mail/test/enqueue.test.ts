import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@repo/db'
import { enqueueMailEvent } from '../src/enqueue.js'

const TAG = '+enqueue-test@anynote.dev'

describe('enqueueMailEvent', () => {
  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: { aggregateType: 'email', payload: { path: ['to'], string_contains: TAG } },
    })
  })

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: { aggregateType: 'email', payload: { path: ['to'], string_contains: TAG } },
    })
  })

  it('creates a PENDING OutboxEvent with expected shape', async () => {
    const userId = '00000000-0000-0000-0000-000000000001'
    await enqueueMailEvent(prisma, {
      kind: 'verify-email',
      to: `t1${TAG}`,
      data: {
        firstName: 'X',
        link: 'https://x',
        expiresAtIso: '2026-04-28T12:00:00.000Z',
      },
      userId,
    })
    const row = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateType: 'email', payload: { path: ['to'], equals: `t1${TAG}` } },
    })
    expect(row.eventType).toBe('email.send')
    expect(row.aggregateType).toBe('email')
    expect(row.aggregateId).toBe(userId)
    expect(row.status).toBe('PENDING')
    expect(row.attempts).toBe(0)
    expect(row.workspaceId).toBeNull()
    const payload = row.payload as { kind: string; to: string }
    expect(payload.kind).toBe('verify-email')
    expect(payload.to).toBe(`t1${TAG}`)
  })

  it('uses random aggregateId when userId is not provided', async () => {
    await enqueueMailEvent(prisma, {
      kind: 'invitation',
      to: `t2${TAG}`,
      data: {
        inviterName: 'A',
        workspaceName: 'WS',
        link: 'https://x',
      },
    })
    const row = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateType: 'email', payload: { path: ['to'], equals: `t2${TAG}` } },
    })
    expect(row.aggregateId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
