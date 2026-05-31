import { describe, expect, it } from 'vitest'

import { parseSlashCommand } from '@/components/workspace/chat/slash-commands'

describe('parseSlashCommand', () => {
  it('is closed for plain text', () => {
    expect(parseSlashCommand('hello')).toEqual({ open: false, query: '' })
  })

  it('opens on a bare slash with an empty query', () => {
    expect(parseSlashCommand('/')).toEqual({ open: true, query: '' })
  })

  it('opens while typing a single-token command and exposes the query', () => {
    expect(parseSlashCommand('/think')).toEqual({ open: true, query: 'think' })
  })

  it('closes once a space follows the command (arguments started)', () => {
    expect(parseSlashCommand('/think foo')).toEqual({ open: false, query: '' })
  })

  it('closes once a newline follows the command', () => {
    expect(parseSlashCommand('/think\nmore')).toEqual({ open: false, query: '' })
  })

  it('is closed when the value does not start with a slash', () => {
    expect(parseSlashCommand(' /think')).toEqual({ open: false, query: '' })
  })
})
