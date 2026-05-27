import { describe, expect, it, jest } from '@jest/globals'

import { PagesController } from './pages.controller.js'

describe('PagesController', () => {
  it('delegates create to PageTools.doCreatePage with req.auth and body', async () => {
    const pageTools = { doCreatePage: jest.fn<() => Promise<{ id: string }>>().mockResolvedValue({ id: 'p1' }) } as any
    const c = new PagesController(pageTools)

    const result = await c.create({ workspaceId: 'w1', title: 't' } as any, {
      auth: { userId: 'u1', source: 'api-key' },
    } as any)

    expect(result).toEqual({ id: 'p1' })
    expect(pageTools.doCreatePage).toHaveBeenCalledWith(
      { userId: 'u1', source: 'api-key' },
      { workspaceId: 'w1', title: 't' },
    )
  })
})
