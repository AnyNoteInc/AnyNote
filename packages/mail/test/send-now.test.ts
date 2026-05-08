import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendEmailMock = vi.fn(async (_args: unknown) => {})

vi.mock('../src/sendsay.ts', () => ({
  sendEmail: (args: unknown) => sendEmailMock(args),
  __resetSendsayClient: () => {},
}))

import { sendMailNow } from '../src/send-now.ts'

describe('sendMailNow', () => {
  beforeEach(() => {
    sendEmailMock.mockReset()
    sendEmailMock.mockResolvedValue(undefined)
  })

  it('renders the template and forwards subject/html/text to sendsay', async () => {
    await sendMailNow({
      kind: 'verify-email',
      to: 'user@example.com',
      data: { firstName: 'Иван', link: 'https://x', expiresAtIso: '2026-04-28T12:00:00Z' },
    })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0][0] as {
      to: string
      subject: string
      text: string
      html: string
    }
    expect(call.to).toBe('user@example.com')
    expect(call.subject).toBeTruthy()
    expect(call.html).toContain('https://x')
  })

  it('propagates the sendsay error so callers can roll back', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('sendsay down'))
    await expect(
      sendMailNow({
        kind: 'reset-password',
        to: 'user@example.com',
        data: { firstName: 'X', link: 'https://x', expiresAtIso: '2026-04-28T12:00:00Z' },
      }),
    ).rejects.toThrow(/sendsay down/)
  })
})
