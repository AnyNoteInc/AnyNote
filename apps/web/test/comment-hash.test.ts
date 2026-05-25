import { describe, expect, it } from 'vitest'

import { parseCommentHash } from '@/components/page/comments/comment-hash'

describe('parseCommentHash', () => {
  it('extracts the id from #comment-<id>', () => {
    expect(parseCommentHash('#comment-abc-123')).toBe('abc-123')
  })

  it('returns null for an empty id', () => {
    expect(parseCommentHash('#comment-')).toBeNull()
  })

  it('returns null for unrelated or empty hashes', () => {
    expect(parseCommentHash('#other')).toBeNull()
    expect(parseCommentHash('')).toBeNull()
  })
})
