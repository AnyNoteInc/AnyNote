import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const requestMock = vi.fn(async (_payload: unknown) => ({}))

vi.mock('sendsay-api', () => {
  const SendsayCtor = vi.fn(function SendsayCtor(this: unknown, _opts: unknown) {
    Object.assign(this as object, { request: requestMock })
  })
  return { default: SendsayCtor }
})

import { sendEmail, __resetSendsayClient } from '../src/sendsay.ts'

describe('sendsay wrapper', () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({})
    process.env.SENDSAY_API_URL = 'https://api.sendsay.test'
    process.env.SENDSAY_API_KEY = 'test-key'
    __resetSendsayClient()
  })

  afterEach(() => {
    delete process.env.SENDSAY_API_URL
    delete process.env.SENDSAY_API_KEY
  })

  it('issues a single issue.send request with the rendered email payload', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
    expect(requestMock).toHaveBeenCalledTimes(1)
    const payload = requestMock.mock.calls[0][0] as {
      action: string
      sendwhen: string
      letter: {
        subject: string
        'from.name': string
        'from.email': string
        message: { html: string; text: string }
      }
      'users.list': string
      group: string
    }
    expect(payload.action).toBe('issue.send')
    expect(payload.sendwhen).toBe('now')
    expect(payload.letter.subject).toBe('Hello')
    expect(payload.letter.message.html).toBe('<p>Hi</p>')
    expect(payload.letter.message.text).toBe('Hi')
    expect(payload['users.list']).toBe('user@example.com')
    expect(payload.letter['from.email']).toBe('noreply@anynote.ru')
    expect(payload.letter['from.name']).toBe('AnyNote')
    expect(payload.group).toBe('transactional')
  })

  it('logs and skips the request when SENDSAY_API_KEY is empty (dev fallback)', async () => {
    delete process.env.SENDSAY_API_KEY
    __resetSendsayClient()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
    expect(requestMock).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[mail] sendsay disabled'))
    infoSpy.mockRestore()
  })

  it('throws when sendsay returns an error envelope', async () => {
    requestMock.mockResolvedValueOnce({ errors: [{ id: 'auth/invalid', explain: 'bad key' }] })
    await expect(
      sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).rejects.toThrow(/sendsay.*auth\/invalid.*bad key/)
  })

  it('propagates network errors thrown by the sendsay client', async () => {
    requestMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(
      sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).rejects.toThrow(/ECONNRESET/)
  })
})
