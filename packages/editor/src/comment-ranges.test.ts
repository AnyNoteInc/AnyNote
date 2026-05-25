import { describe, expect, it } from 'vitest'

import { mergeRanges } from './comment-ranges'

// Comment highlights are translucent, so two threads covering intersecting text
// get nested spans whose backgrounds compound into a darker patch. Merging the
// ranges first means every character is covered by exactly one highlight span.
describe('mergeRanges', () => {
  it('returns empty for no ranges', () => {
    expect(mergeRanges([])).toEqual([])
  })

  it('keeps a single range', () => {
    expect(mergeRanges([{ from: 2, to: 5 }])).toEqual([{ from: 2, to: 5 }])
  })

  it('keeps disjoint ranges, sorted by start', () => {
    expect(
      mergeRanges([
        { from: 10, to: 15 },
        { from: 0, to: 5 },
      ]),
    ).toEqual([
      { from: 0, to: 5 },
      { from: 10, to: 15 },
    ])
  })

  it('merges overlapping ranges into one (the stacked-highlight bug)', () => {
    expect(
      mergeRanges([
        { from: 0, to: 5 },
        { from: 3, to: 8 },
      ]),
    ).toEqual([{ from: 0, to: 8 }])
  })

  it('absorbs a fully nested range into its container', () => {
    expect(
      mergeRanges([
        { from: 0, to: 10 },
        { from: 3, to: 6 },
      ]),
    ).toEqual([{ from: 0, to: 10 }])
  })

  it('merges touching ranges (end === next start)', () => {
    expect(
      mergeRanges([
        { from: 0, to: 5 },
        { from: 5, to: 9 },
      ]),
    ).toEqual([{ from: 0, to: 9 }])
  })

  it('collapses a chain of overlaps into a single range', () => {
    expect(
      mergeRanges([
        { from: 0, to: 4 },
        { from: 3, to: 7 },
        { from: 6, to: 10 },
      ]),
    ).toEqual([{ from: 0, to: 10 }])
  })

  it('drops zero-length ranges', () => {
    expect(
      mergeRanges([
        { from: 4, to: 4 },
        { from: 1, to: 3 },
      ]),
    ).toEqual([{ from: 1, to: 3 }])
  })

  it('does not mutate the input', () => {
    const input = [
      { from: 3, to: 8 },
      { from: 0, to: 5 },
    ]
    const snapshot = structuredClone(input)
    mergeRanges(input)
    expect(input).toEqual(snapshot)
  })
})
