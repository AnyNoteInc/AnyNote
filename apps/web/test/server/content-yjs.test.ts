import { describe, expect, it } from 'vitest'
import { TiptapTransformer } from '@hocuspocus/transformer'
import * as Y from 'yjs'

import { buildImportContentYjs } from '../../src/server/page-import/content-yjs'
import { markdownToTiptap } from '../../src/server/page-import/markdown-to-tiptap'

const FULL_MD = [
  '# H',
  '',
  'Текст **жирный** _курсив_ `код` [ссылка](https://e.com)',
  '',
  '- [ ] задача',
  '- пункт',
  '',
  '1. раз',
  '',
  '> цитата',
  '',
  '```js',
  'x()',
  '```',
  '',
  '---',
  '',
  '![img](https://e.com/i.png)',
].join('\n')

describe('buildImportContentYjs', () => {
  it('encodes every parser-emitted node type and survives a Yjs roundtrip', () => {
    const doc = markdownToTiptap(FULL_MD)
    const bytes = buildImportContentYjs(doc)
    expect(bytes.byteLength).toBeGreaterThan(0)

    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, bytes)
    const roundtripped = TiptapTransformer.fromYdoc(ydoc, 'default') as { type: string }
    expect(roundtripped.type).toBe('doc')
    expect(JSON.stringify(roundtripped)).toContain('задача')
  })
})
