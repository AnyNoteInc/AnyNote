import { describe, expect, it } from 'vitest'

import { deriveCommentViews, type RawThread } from '@/components/page/comments/comments-context'

const rawThreads: RawThread[] = [
  {
    id: 't1',
    anchorStart: 'A',
    anchorEnd: 'B',
    quotedText: 'Q1',
    resolvedAt: null,
    comments: [
      {
        id: 'c1',
        authorId: 'u1',
        authorName: 'Анна',
        content: { text: 'привет' },
        createdAt: '2026-05-25T10:00:00Z',
      },
    ],
  },
  {
    id: 't2',
    anchorStart: 'C',
    anchorEnd: 'D',
    quotedText: 'Q2',
    resolvedAt: '2026-05-25T11:00:00Z',
    comments: [],
  },
]

describe('deriveCommentViews', () => {
  it('derives anchors, ui threads, and the active count', () => {
    const { anchors, uiThreads, activeCount } = deriveCommentViews(rawThreads)
    expect(anchors).toEqual([
      { id: 't1', anchorStart: 'A', anchorEnd: 'B', resolvedAt: null },
      { id: 't2', anchorStart: 'C', anchorEnd: 'D', resolvedAt: '2026-05-25T11:00:00Z' },
    ])
    expect(uiThreads[0]).toMatchObject({ id: 't1', quotedText: 'Q1' })
    expect(uiThreads[0]?.comments[0]).toMatchObject({
      id: 'c1',
      authorName: 'Анна',
      content: { text: 'привет' },
    })
    expect(activeCount).toBe(1)
  })

  it('defaults missing comment content to empty text', () => {
    const { uiThreads } = deriveCommentViews([
      {
        id: 't',
        anchorStart: 'A',
        anchorEnd: 'B',
        quotedText: 'q',
        resolvedAt: null,
        comments: [{ id: 'c', authorId: null, authorName: 'X', content: null, createdAt: '2026-05-25T10:00:00Z' }],
      },
    ])
    expect(uiThreads[0]?.comments[0]?.content).toEqual({ text: '' })
  })
})
