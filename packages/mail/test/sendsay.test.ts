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
    expect(payload.group).toBe('personal')
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

  it('logs and swallows when sendsay returns an error envelope', async () => {
    requestMock.mockResolvedValueOnce({ errors: [{ id: 'auth/invalid', explain: 'bad key' }] })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/auth\/invalid.*bad key/))
    warnSpy.mockRestore()
  })

  it('logs and swallows the plain-object error thrown by sendsay-api on access denial', async () => {
    // The real sendsay-api SDK throws res.errors[0] as a plain object before
    // returning, not an Error — exercise that path so callers (auth sign-up,
    // password reset) don't see opaque rejections.
    requestMock.mockRejectedValueOnce({
      sublogin: 'luferovaea',
      account: 'x_17781667411017429',
      action: 'issue.send',
      id: 'access_denied',
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/access_denied/))
    warnSpy.mockRestore()
  })

  it('logs and swallows network errors thrown by the sendsay client', async () => {
    requestMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/ECONNRESET/))
    warnSpy.mockRestore()
  })
})
