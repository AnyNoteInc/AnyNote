import { beforeEach, describe, expect, it, jest } from '@jest/globals'

// SentryGlobalFilter (APP_FILTER) only catches the HTTP request pipeline — it
// does NOT catch throws inside @Cron methods. So the cron must capture itself.
// Mock the module BEFORE importing the service so the in-method captureException
// resolves to the spy.
const mockCaptureException = jest.fn()

jest.unstable_mockModule('@sentry/nestjs', () => ({
  captureException: mockCaptureException,
}))

const { SubscriptionRenewalCronService } = await import('./subscription-renewal-cron.service.js')

type RenewalLike = {
  expireCanceled: jest.Mock<() => Promise<void>>
  renewActive: jest.Mock<() => Promise<void>>
}

function makeRenewal(): RenewalLike {
  return {
    expireCanceled: jest.fn<() => Promise<void>>().mockResolvedValue(),
    renewActive: jest.fn<() => Promise<void>>().mockResolvedValue(),
  }
}

beforeEach(() => {
  mockCaptureException.mockClear()
})

describe('SubscriptionRenewalCronService', () => {
  it('runs expireCanceled then renewActive on the happy path without capturing', async () => {
    const renewal = makeRenewal()
    const svc = new SubscriptionRenewalCronService(renewal as never)

    await expect(svc.handleRenewals()).resolves.toBeUndefined()

    expect(renewal.expireCanceled).toHaveBeenCalledTimes(1)
    expect(renewal.renewActive).toHaveBeenCalledTimes(1)
    expect(mockCaptureException).not.toHaveBeenCalled()
  })

  it('captures an expireCanceled failure to Sentry without rethrowing (the money-path leak)', async () => {
    const err = new Error('db down')
    const renewal = makeRenewal()
    renewal.expireCanceled.mockRejectedValueOnce(err)
    const svc = new SubscriptionRenewalCronService(renewal as never)
    const logError = jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined)

    await expect(svc.handleRenewals()).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith('subscription renewal cron failed', err)
    expect(mockCaptureException).toHaveBeenCalledTimes(1)
    expect(mockCaptureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tags: expect.objectContaining({ service: 'engines', worker: 'billing-renewal' }),
      }),
    )
    // a failed batch-claim must not silently let renewActive proceed
    expect(renewal.renewActive).not.toHaveBeenCalled()
  })

  it('captures a renewActive failure to Sentry without rethrowing', async () => {
    const err = new Error('renew batch boom')
    const renewal = makeRenewal()
    renewal.renewActive.mockRejectedValueOnce(err)
    const svc = new SubscriptionRenewalCronService(renewal as never)
    jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined)

    await expect(svc.handleRenewals()).resolves.toBeUndefined()

    expect(renewal.expireCanceled).toHaveBeenCalledTimes(1)
    expect(mockCaptureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tags: expect.objectContaining({ service: 'engines', worker: 'billing-renewal' }),
      }),
    )
  })
})
