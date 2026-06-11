import { hostname } from 'node:os'

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

// Env must be set BEFORE the service module is imported: the option fields are
// read from process.env at construction / decoration time.
process.env.TELEGRAM_BATCH_SIZE = '7'
process.env.TELEGRAM_MAX_ATTEMPTS = '3'
process.env.TELEGRAM_TIMEOUT_MS = '1234'

const mockRunTelegramFanOutTick = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue()
const mockRunTelegramDeliveryTick = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue()

jest.unstable_mockModule('@repo/telegram/worker', () => ({
  runTelegramFanOutTick: mockRunTelegramFanOutTick,
  runTelegramDeliveryTick: mockRunTelegramDeliveryTick,
}))

const { TelegramCronService } = await import('./telegram-cron.service.js')

const prisma = {} as never

beforeEach(() => {
  mockRunTelegramFanOutTick.mockClear()
  mockRunTelegramFanOutTick.mockResolvedValue()
  mockRunTelegramDeliveryTick.mockClear()
  mockRunTelegramDeliveryTick.mockResolvedValue()
})

describe('TelegramCronService', () => {
  it('tick runs fan-out then delivery with env-derived options', async () => {
    const svc = new TelegramCronService(prisma)
    await svc.tick()

    const workerId = `telegram-${hostname()}-${process.pid}`
    expect(mockRunTelegramFanOutTick).toHaveBeenCalledTimes(1)
    expect(mockRunTelegramFanOutTick).toHaveBeenCalledWith(prisma, { workerId, batchSize: 7 })
    expect(mockRunTelegramDeliveryTick).toHaveBeenCalledTimes(1)
    expect(mockRunTelegramDeliveryTick).toHaveBeenCalledWith(prisma, {
      workerId,
      batchSize: 7,
      maxAttempts: 3,
      timeoutMs: 1234,
    })
    expect(mockRunTelegramFanOutTick.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunTelegramDeliveryTick.mock.invocationCallOrder[0] as number,
    )
  })

  it('catches and logs a fan-out failure without rethrowing (delivery skipped)', async () => {
    const err = new Error('fan-out boom')
    mockRunTelegramFanOutTick.mockRejectedValueOnce(err)
    const svc = new TelegramCronService(prisma)
    const logError = jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined)

    await expect(svc.tick()).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith('telegram tick failed', err)
    expect(mockRunTelegramDeliveryTick).not.toHaveBeenCalled()
  })

  it('catches and logs a delivery failure without rethrowing', async () => {
    const err = new Error('delivery boom')
    mockRunTelegramDeliveryTick.mockRejectedValueOnce(err)
    const svc = new TelegramCronService(prisma)
    const logError = jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined)

    await expect(svc.tick()).resolves.toBeUndefined()

    expect(mockRunTelegramFanOutTick).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith('telegram tick failed', err)
  })
})
