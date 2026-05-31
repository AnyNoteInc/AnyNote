import { describe, expect, it } from 'vitest'

import { buildOptimisticPair } from '../src/components/workspace/chat/optimistic'

describe('buildOptimisticPair', () => {
  it('creates a user message + empty streaming assistant with temp ids', () => {
    const { userMessage, assistantMessage } = buildOptimisticPair({ text: 'hi', attachments: [] })
    expect(userMessage.role).toBe('user')
    expect(userMessage.parts.some((p) => p.type === 'text')).toBe(true)
    expect(assistantMessage.role).toBe('assistant')
    expect(assistantMessage.status).toBe('streaming')
    expect(userMessage.id).not.toBe(assistantMessage.id)
  })

  it('generates unique temp ids across calls', () => {
    const a = buildOptimisticPair({ text: 'x', attachments: [] })
    const b = buildOptimisticPair({ text: 'y', attachments: [] })
    expect(a.userMessage.id).not.toBe(b.userMessage.id)
  })

  it('marks the user message as sent and the assistant placeholder as streaming', () => {
    const { userMessage, assistantMessage } = buildOptimisticPair({ text: 'hi', attachments: [] })
    expect(userMessage.status).toBe('sent')
    expect(assistantMessage.status).toBe('streaming')
    expect(assistantMessage.parts).toEqual([])
  })

  it('uses temp- prefixed ids so they can be reconciled later', () => {
    const { userMessage, assistantMessage } = buildOptimisticPair({ text: 'hi', attachments: [] })
    expect(userMessage.id.startsWith('temp-user-')).toBe(true)
    expect(assistantMessage.id.startsWith('temp-asst-')).toBe(true)
  })

  it('mirrors the persisted text + attachment part shape', () => {
    const { userMessage } = buildOptimisticPair({
      text: 'caption',
      attachments: [
        {
          fileId: 'file-1',
          name: 'doc.pdf',
          mimeType: 'application/pdf',
          fileSize: '1024',
        },
      ],
    })

    expect(userMessage.parts).toEqual([
      { type: 'text', text: 'caption' },
      {
        type: 'attacment',
        fileId: 'file-1',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        fileSize: '1024',
        downloadUrl: '/api/files/file-1',
      },
    ])
  })
})
