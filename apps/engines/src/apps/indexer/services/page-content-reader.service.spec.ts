import { describe, expect, it } from '@jest/globals'

import { PageContentReader, type TiptapNode } from './page-content-reader.service.js'

describe('PageContentReader', () => {
  const reader = new PageContentReader()

  it('returns [] for null/undefined/non-doc', () => {
    expect(reader.blocksFromDoc(null as unknown as TiptapNode)).toEqual([])
    expect(reader.blocksFromDoc({ type: 'paragraph' })).toEqual([])
  })

  it('collects text from a single paragraph', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([{ blockNumber: 0, content: 'Hello' }])
  })

  it('preserves blockNumber even when some blocks are skipped', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'image', attrs: {} },
        { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([
      { blockNumber: 1, content: 'A' },
      { blockNumber: 3, content: 'B' },
    ])
  })

  it('skips empty blocks', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'hit' }] },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([{ blockNumber: 2, content: 'hit' }])
  })

  it('recursively collects text from callout, skipping nested image/heading', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'keep' }] },
            { type: 'image', attrs: {} },
            { type: 'heading', content: [{ type: 'text', text: 'drop' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'also keep' }] },
          ],
        },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([{ blockNumber: 0, content: 'keep   also keep' }])
  })

  it('joins inline text nodes with space', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'foo' },
            { type: 'text', text: 'bar' },
          ],
        },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([{ blockNumber: 0, content: 'foo bar' }])
  })
})
