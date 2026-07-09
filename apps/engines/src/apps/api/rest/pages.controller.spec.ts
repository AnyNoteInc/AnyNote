import { describe, expect, it, jest } from '@jest/globals'

import type { PageTools } from '../../mcp/tools/page.tools.js'
import type { AuthedRequest } from '../auth/auth-context.js'
import type { CreatePageDto } from '../dto/pages.dto.js'
import { PagesController } from './pages.controller.js'

describe('PagesController', () => {
  it('delegates create to PageTools.doCreatePage with req.auth and body', async () => {
    const doCreatePageMock = jest
      .fn<(...args: unknown[]) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: 'p1' })
    const pageTools = { doCreatePage: doCreatePageMock } as unknown as PageTools
    const c = new PagesController(pageTools)

    const body = { workspaceId: 'w1', title: 't' } as unknown as CreatePageDto
    const req = { auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
    const result = await c.create(body, req)

    expect(result).toEqual({ id: 'p1' })
    expect(doCreatePageMock).toHaveBeenCalledWith(
      { userId: 'u1', source: 'api-key' },
      { workspaceId: 'w1', title: 't' },
    )
  })
})
