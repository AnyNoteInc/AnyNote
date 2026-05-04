import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@repo/db'

vi.mock('server-only', () => ({}))

import { dispatchPending } from '../src/dispatch.ts'

const TAG = '+dispatch-test@anynote.dev'

const sendMailMock = vi.fn(async () => ({ messageId: 'msg-1' }))
vi.mock('../src/transport.js', () => ({
  getMailTransport: () => ({ sendMail: sendMailMock }),
  __resetMailTransport: () => {},
}))

async function insertPending(to: string): Promise<bigint> {
  const row = await prisma.outboxEvent.create({
    data: {
      aggregateType: 'email',
      aggregateId: '00000000-0000-0000-0000-000000000001',
      eventType: 'email.send',
      payload: {
        kind: 'verify-email',
        to,
        data: { firstName: 'X', link: 'https://x', expiresAtIso: '2026-04-28T12:00:00Z' },
      },
    },
  })
  return row.id
}

describe('dispatchPending', () => {
  beforeEach(async () => {
    sendMailMock.mockReset()
    sendMailMock.mockResolvedValue({ messageId: 'msg-1' })
    process.env.MAIL_FROM = process.env.MAIL_FROM ?? 'AnyNote <noreply@anynote.local>'
    await prisma.outboxEvent.deleteMany({
      where: {
        aggregateType: 'email',
        eventType: 'email.send',
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    })
  })

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: { aggregateType: 'email', payload: { path: ['to'], string_contains: TAG } },
    })
  })

  it('happy path: marks DONE on success', async () => {
    const id = await insertPending(`hp${TAG}`)
    const result = await dispatchPending(prisma, {
      batch: 10,
      maxAttempts: 5,
      workerId: 'test-w-1',
    })
    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('DONE')
    expect(row.processedAt).not.toBeNull()
  })

  it('retry on failure: keeps PENDING with attempts=1', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SMTP down'))
    const id = await insertPending(`rt${TAG}`)
    const result = await dispatchPending(prisma, {
      batch: 10,
      maxAttempts: 5,
      workerId: 'test-w-2',
    })
    expect(result.failed + result.retried).toBe(1)
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('PENDING')
    expect(row.attempts).toBe(1)
    expect(row.lastError).toContain('SMTP down')
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('masks tokens in lastError when SMTP error message includes the link', async () => {
    sendMailMock.mockRejectedValueOnce(
      new Error('Bounce: undeliverable https://anynote.local/reset-credentials/SECRET_TOKEN_42'),
    )
    const id = await insertPending(`mt${TAG}`)
    await dispatchPending(prisma, { batch: 10, maxAttempts: 5, workerId: 'test-w-mask' })
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })
    expect(row.lastError).not.toContain('SECRET_TOKEN_42')
    expect(row.lastError).toContain('https://anynote.local')
  })

  it('marks FAILED after max attempts', async () => {
    sendMailMock.mockRejectedValue(new Error('boom'))
    const id = await insertPending(`fa${TAG}`)
    await prisma.outboxEvent.update({ where: { id }, data: { attempts: 4 } })
    await dispatchPending(prisma, { batch: 10, maxAttempts: 5, workerId: 'test-w-3' })
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('FAILED')
    expect(row.attempts).toBe(5)
  })

  it('respects batch size', async () => {
    for (let i = 0; i < 4; i += 1) await insertPending(`b${i}${TAG}`)
    await dispatchPending(prisma, { batch: 2, maxAttempts: 5, workerId: 'test-w-4' })
    const remaining = await prisma.outboxEvent.count({
      where: {
        aggregateType: 'email',
        status: 'PENDING',
        payload: { path: ['to'], string_contains: TAG },
      },
    })
    expect(remaining).toBe(2)
  })

  it('returns zero processed when no PENDING rows', async () => {
    const result = await dispatchPending(prisma, {
      batch: 10,
      maxAttempts: 5,
      workerId: 'test-w-5',
    })
    expect(result.processed).toBe(0)
  })
})
