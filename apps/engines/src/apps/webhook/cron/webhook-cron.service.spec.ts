import { hostname } from 'node:os'

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

// Env must be set BEFORE the service module is imported: the option fields are
// read from process.env at construction / decoration time.
process.env.WEBHOOK_BATCH_SIZE = '7'
process.env.WEBHOOK_MAX_ATTEMPTS = '3'
process.env.WEBHOOK_TIMEOUT_MS = '1234'

const mockRunFanOutTick = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue()
const mockRunDeliveryTick = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue()

jest.unstable_mockModule('@repo/webhooks/worker', () => ({
  runFanOutTick: mockRunFanOutTick,
  runDeliveryTick: mockRunDeliveryTick,
}))

const { WebhookCronService } = await import('./webhook-cron.service.js')

const prisma = {} as never

beforeEach(() => {
  mockRunFanOutTick.mockClear()
  mockRunFanOutTick.mockResolvedValue()
  mockRunDeliveryTick.mockClear()
  mockRunDeliveryTick.mockResolvedValue()
})

describe('WebhookCronService', () => {
  it('tick runs fan-out then delivery with env-derived options', async () => {
    const svc = new WebhookCronService(prisma)
    await svc.tick()

    const workerId = `webhook-${hostname()}-${process.pid}`
    expect(mockRunFanOutTick).toHaveBeenCalledTimes(1)
    expect(mockRunFanOutTick).toHaveBeenCalledWith(prisma, { workerId, batchSize: 7 })
    expect(mockRunDeliveryTick).toHaveBeenCalledTimes(1)
    expect(mockRunDeliveryTick).toHaveBeenCalledWith(prisma, {
      workerId,
      batchSize: 7,
      maxAttempts: 3,
      timeoutMs: 1234,
    })
    expect(mockRunFanOutTick.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunDeliveryTick.mock.invocationCallOrder[0] as number,
    )
  })

  it('catches and logs a fan-out failure without rethrowing (delivery skipped)', async () => {
    const err = new Error('fan-out boom')
    mockRunFanOutTick.mockRejectedValueOnce(err)
    const svc = new WebhookCronService(prisma)
    const logError = jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined)

    await expect(svc.tick()).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith('webhook tick failed', err)
    expect(mockRunDeliveryTick).not.toHaveBeenCalled()
  })

  it('catches and logs a delivery failure without rethrowing', async () => {
    const err = new Error('delivery boom')
    mockRunDeliveryTick.mockRejectedValueOnce(err)
    const svc = new WebhookCronService(prisma)
    const logError = jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined)

    await expect(svc.tick()).resolves.toBeUndefined()

    expect(mockRunFanOutTick).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith('webhook tick failed', err)
  })
})
