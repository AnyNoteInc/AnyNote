import { describe, it, expect } from '@jest/globals'

import {
  FileNotFoundError,
  FileTooLargeError,
  PageNotFoundError,
  UnsupportedMimeTypeError,
  WorkspaceAccessDeniedError,
} from './mcp.errors.js'

describe('MCP errors', () => {
  it('WorkspaceAccessDeniedError → 403 WORKSPACE_ACCESS_DENIED', () => {
    const err = new WorkspaceAccessDeniedError('w1', 'u1')
    expect(err.getStatus()).toBe(403)
    expect(err.getResponse()).toMatchObject({ code: 'WORKSPACE_ACCESS_DENIED' })
  })

  it('PageNotFoundError → 404', () => {
    expect(new PageNotFoundError('p1').getStatus()).toBe(404)
  })

  it('FileNotFoundError → 404', () => {
    expect(new FileNotFoundError('f1').getStatus()).toBe(404)
  })

  it('FileTooLargeError → 413 with limit in message', () => {
    const err = new FileTooLargeError(5_000_000, 1_048_576)
    expect(err.getStatus()).toBe(413)
    expect((err.getResponse() as { message: string }).message).toContain('attach')
  })

  it('UnsupportedMimeTypeError → 415', () => {
    expect(new UnsupportedMimeTypeError('text/exotic').getStatus()).toBe(415)
  })
})
