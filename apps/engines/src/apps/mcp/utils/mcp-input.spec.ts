import { describe, expect, it } from '@jest/globals'

import { mcpUuid } from './mcp-input.js'

describe('mcpUuid', () => {
  it('extracts a UUID from a nested natural-language argument object', () => {
    const schema = mcpUuid()
    const pageId = '6bdb6a47-5bb3-4fb5-8ae1-75a7ada684ae'

    const result = schema.safeParse({
      query: `кто создал страницу ${pageId}`,
    })

    expect(result).toEqual({ success: true, data: pageId })
  })
})
