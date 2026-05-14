import { describe, expect, it, vi, beforeEach } from 'vitest'

const { sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(async () => ({ statusCode: 201 })),
  setVapidDetailsMock: vi.fn(),
}))

vi.mock('web-push', () => ({
  default: { sendNotification: sendNotificationMock, setVapidDetails: setVapidDetailsMock },
  sendNotification: sendNotificationMock,
  setVapidDetails: setVapidDetailsMock,
}))

import { sendDeliveryWebPush, GoneSubscriptionError } from '../../src/worker/send-web-push.ts'

beforeEach(() => {
  sendNotificationMock.mockReset()
  sendNotificationMock.mockResolvedValue({ statusCode: 201 })
  process.env.VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.VAPID_SUBJECT = 'mailto:noreply@anynote.dev'
})

describe('sendDeliveryWebPush', () => {
  it('sends push payload to subscription endpoint', async () => {
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: { endpoint: 'https://push/x', p256dh: 'p', auth: 'a' },
      event: {
        type: 'WORKSPACE_INVITE',
        payload: { workspaceName: 'X', inviterName: 'A' },
        resourceUrl: '/workspaces/x',
      },
    } as never
    await sendDeliveryWebPush(delivery)
    expect(sendNotificationMock).toHaveBeenCalledOnce()
    const [sub, payload] = sendNotificationMock.mock.calls[0] as unknown as [
      { endpoint: string },
      string,
    ]
    expect(sub.endpoint).toBe('https://push/x')
    const parsed = JSON.parse(payload)
    expect(parsed.url).toBe('/workspaces/x')
  })

  it('throws GoneSubscriptionError on 410', async () => {
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 })
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: { endpoint: 'https://push/x', p256dh: 'p', auth: 'a' },
      event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null },
    } as never
    await expect(sendDeliveryWebPush(delivery)).rejects.toBeInstanceOf(GoneSubscriptionError)
  })

  it('throws GoneSubscriptionError on 404', async () => {
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 404 })
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: { endpoint: 'https://push/x', p256dh: 'p', auth: 'a' },
      event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null },
    } as never
    await expect(sendDeliveryWebPush(delivery)).rejects.toBeInstanceOf(GoneSubscriptionError)
  })

  it('throws raw error on other status codes', async () => {
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 500, body: 'oops' })
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: { endpoint: 'https://push/x', p256dh: 'p', auth: 'a' },
      event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null },
    } as never
    await expect(sendDeliveryWebPush(delivery)).rejects.not.toBeInstanceOf(GoneSubscriptionError)
  })

  it('throws if subscription is missing', async () => {
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: null,
      event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null },
    } as never
    await expect(sendDeliveryWebPush(delivery)).rejects.toThrow(/subscription/i)
  })
})
