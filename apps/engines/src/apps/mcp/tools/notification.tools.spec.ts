import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { NotificationService } from '../services/notification.service.js'
import { NotificationTools } from './notification.tools.js'

describe('NotificationTools', () => {
  const list = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const markRead = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const service = { list, markRead } as unknown as NotificationService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: NotificationTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new NotificationTools(service)
  })

  it('listNotifications forwards defaults', async () => {
    list.mockResolvedValue([])
    const out = await tools.listNotifications({ unreadOnly: true, limit: 50 }, {} as never, req)
    expect(out).toEqual({ notifications: [] })
    expect(list).toHaveBeenCalledWith({ userId: 'u1', unreadOnly: true, limit: 50 })
  })

  it('markNotificationsRead(all) forwards', async () => {
    markRead.mockResolvedValue({ count: 2 })
    const out = await tools.markNotificationsRead({ all: true }, {} as never, req)
    expect(out).toEqual({ count: 2 })
  })

  it('markNotificationsRead rejects empty selector', async () => {
    await expect(
      tools.markNotificationsRead({}, {} as never, req),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('throws Unauthorized without auth', async () => {
    await expect(
      tools.listNotifications({ unreadOnly: true, limit: 50 }, {} as never, { headers: {} } as AuthedRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
