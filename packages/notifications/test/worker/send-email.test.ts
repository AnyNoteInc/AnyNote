import { describe, expect, it, vi } from 'vitest'

const { sendMailNowMock, renderMock } = vi.hoisted(() => ({
  sendMailNowMock: vi.fn(async () => undefined),
  renderMock: vi.fn(() => ({
    kind: 'invitation',
    data: { firstName: 'A', inviterName: 'B', workspaceName: 'X', link: 'l' },
  })),
}))

vi.mock('@repo/mail', () => ({ sendMailNow: sendMailNowMock }))
vi.mock('../../src/templates/email.ts', () => ({ renderEmailForEvent: renderMock }))

import { sendDeliveryEmail } from '../../src/worker/send-email.ts'

describe('sendDeliveryEmail', () => {
  it('renders by event type and calls sendMailNow with target email', async () => {
    sendMailNowMock.mockClear()
    const delivery = {
      id: 'd1',
      channel: 'EMAIL',
      targetEmail: 'to@e.com',
      event: { type: 'WORKSPACE_INVITE', payload: { workspaceName: 'X' } },
    } as never
    await sendDeliveryEmail(delivery)
    expect(sendMailNowMock).toHaveBeenCalledOnce()
    expect(sendMailNowMock.mock.calls[0][0]).toMatchObject({
      to: 'to@e.com',
      kind: 'invitation',
    })
  })

  it('throws if no template registered for event type', async () => {
    renderMock.mockReturnValueOnce(null as never)
    const delivery = {
      id: 'd1',
      channel: 'EMAIL',
      targetEmail: 'to@e.com',
      event: { type: 'ROLE_CHANGED', payload: {} },
    } as never
    await expect(sendDeliveryEmail(delivery)).rejects.toThrow(/no email template/i)
  })

  it('throws if targetEmail missing', async () => {
    const delivery = {
      id: 'd1',
      channel: 'EMAIL',
      targetEmail: null,
      event: { type: 'WORKSPACE_INVITE', payload: {} },
    } as never
    await expect(sendDeliveryEmail(delivery)).rejects.toThrow(/target email/i)
  })
})
