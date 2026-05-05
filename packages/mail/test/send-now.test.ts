import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const sendMailMock = vi.fn(async () => ({ messageId: 'msg-1' }))
vi.mock('../src/transport.js', () => ({
  getMailTransport: () => ({ sendMail: sendMailMock }),
  __resetMailTransport: () => {},
}))

import { sendMailNow } from '../src/send-now.ts'

describe('sendMailNow', () => {
  beforeEach(() => {
    sendMailMock.mockReset()
    sendMailMock.mockResolvedValue({ messageId: 'msg-1' })
    process.env.MAIL_FROM = 'AnyNote <noreply@anynote.local>'
  })

  it('renders the template and sends through the transport', async () => {
    await sendMailNow({
      kind: 'verify-email',
      to: 'user@example.com',
      data: { firstName: 'Иван', link: 'https://x', expiresAtIso: '2026-04-28T12:00:00Z' },
    })
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0] as {
      from: string
      to: string
      subject: string
      text: string
      html: string
    }
    expect(call.to).toBe('user@example.com')
    expect(call.from).toBe('AnyNote <noreply@anynote.local>')
    expect(call.subject).toBeTruthy()
    expect(call.html).toContain('https://x')
  })

  it('throws when MAIL_FROM is not configured', async () => {
    delete process.env.MAIL_FROM
    await expect(
      sendMailNow({
        kind: 'verify-email',
        to: 'user@example.com',
        data: { firstName: 'X', link: 'https://x', expiresAtIso: '2026-04-28T12:00:00Z' },
      }),
    ).rejects.toThrow(/MAIL_FROM/)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('propagates the transport error so callers can roll back', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SMTP down'))
    await expect(
      sendMailNow({
        kind: 'reset-password',
        to: 'user@example.com',
        data: { firstName: 'X', link: 'https://x', expiresAtIso: '2026-04-28T12:00:00Z' },
      }),
    ).rejects.toThrow(/SMTP down/)
  })
})
