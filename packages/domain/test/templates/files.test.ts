import { describe, it, expect } from 'vitest'

import { extractFileIdsFromContent } from '../../src/templates/templates.files.ts'

describe('extractFileIdsFromContent', () => {
  it('collects image src and file-attachment url file ids', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: '/api/files/11111111-1111-4111-8111-111111111111' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        {
          type: 'fileAttachment',
          attrs: { url: '/api/files/22222222-2222-4222-8222-222222222222' },
        },
        { type: 'image', attrs: { src: 'https://external.example/x.png' } },
      ],
    }
    expect(extractFileIdsFromContent(doc).sort()).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
  })

  it('returns [] for empty / non-doc content', () => {
    expect(extractFileIdsFromContent(null)).toEqual([])
    expect(extractFileIdsFromContent({ foo: 1 })).toEqual([])
  })
})
