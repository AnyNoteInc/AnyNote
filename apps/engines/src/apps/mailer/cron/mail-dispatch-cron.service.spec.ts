import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals'

const dispatchMock = jest.fn(async () => ({
  processed: 0,
  succeeded: 0,
  failed: 0,
  retried: 0,
}))

jest.unstable_mockModule('@repo/mail/dispatch', () => ({
  dispatchPending: dispatchMock,
}))

const { MailDispatchCronService } = await import('./mail-dispatch-cron.service.js')

describe('MailDispatchCronService', () => {
  beforeEach(() => {
    dispatchMock.mockClear()
    dispatchMock.mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, retried: 0 })
  })

  afterEach(() => {
    delete process.env.MAIL_DISPATCH_BATCH
    delete process.env.MAIL_DISPATCH_MAX_ATTEMPTS
    delete process.env.HOSTNAME
  })

  it('does not log when nothing processed', async () => {
    const svc = new MailDispatchCronService({} as never)
    await svc.tick()
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })

  it('forwards configured batch / maxAttempts / workerId to dispatchPending', async () => {
    process.env.MAIL_DISPATCH_BATCH = '7'
    process.env.MAIL_DISPATCH_MAX_ATTEMPTS = '3'
    process.env.HOSTNAME = 'test-host'
    const svc = new MailDispatchCronService({ tag: 'prisma' } as never)
    await svc.tick()
    const call = dispatchMock.mock.calls[0] as unknown as [
      unknown,
      { batch: number; maxAttempts: number; workerId: string },
    ]
    expect(call[1].batch).toBe(7)
    expect(call[1].maxAttempts).toBe(3)
    expect(call[1].workerId).toContain('engines-mailer-')
  })

  it('passes prisma instance through to dispatchPending', async () => {
    const prisma = { tag: 'prisma' }
    const svc = new MailDispatchCronService(prisma as never)
    await svc.tick()
    const call = dispatchMock.mock.calls[0] as unknown as [unknown, unknown]
    expect(call[0]).toBe(prisma)
  })

  it('logs only when processed > 0', async () => {
    dispatchMock.mockResolvedValueOnce({
      processed: 3,
      succeeded: 2,
      failed: 1,
      retried: 0,
    })
    const svc = new MailDispatchCronService({} as never)
    const logSpy = jest.spyOn(
      (svc as unknown as { log: { log: (msg: string) => void } }).log,
      'log',
    )
    await svc.tick()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('processed=3'))
  })

  it('catches errors from dispatchPending and logs without rethrowing', async () => {
    dispatchMock.mockRejectedValueOnce(new Error('db down'))
    const svc = new MailDispatchCronService({} as never)
    const errorSpy = jest.spyOn(
      (svc as unknown as { log: { error: (msg: string) => void } }).log,
      'error',
    )
    await expect(svc.tick()).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db down'))
  })
})
