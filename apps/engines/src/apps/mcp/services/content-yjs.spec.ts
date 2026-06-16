import { describe, it, expect } from '@jest/globals'
import { TiptapTransformer } from '@hocuspocus/transformer'
import * as Y from 'yjs'

import { buildContentYjs } from './content-yjs.js'

describe('buildContentYjs', () => {
  it('serializes a table node into contentYjs so it round-trips', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }],
                },
              ],
            },
          ],
        },
      ],
    }
    const bytes = buildContentYjs(doc)
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, bytes)
    const back = TiptapTransformer.fromYdoc(ydoc, 'default') as { content?: { type: string }[] }
    expect(back.content?.some((n) => n.type === 'table')).toBe(true)
  })
})
