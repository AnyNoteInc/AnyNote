import { describe, expect, it } from 'vitest'

import type { MeetingSegment } from '@repo/trpc'

import { filterSegments } from '../src/components/meeting/filter-segments'

const seg = (
  id: string,
  idx: number,
  text: string,
  speaker: string | null = null,
): MeetingSegment => ({
  id,
  idx,
  startMs: idx * 1000,
  endMs: idx * 1000 + 900,
  speaker,
  text,
})

const SEGMENTS: MeetingSegment[] = [
  seg('a', 0, 'Обсудили бюджет на следующий квартал', 'Анна'),
  seg('b', 1, 'Договорились о сроках поставки', 'Борис'),
  seg('c', 2, 'BUDGET review and approval', 'Charlie'),
]

describe('filterSegments', () => {
  it('returns all segments for an empty query', () => {
    expect(filterSegments(SEGMENTS, '')).toBe(SEGMENTS)
    expect(filterSegments(SEGMENTS, '   ')).toBe(SEGMENTS)
  })

  it('matches text case-insensitively', () => {
    const out = filterSegments(SEGMENTS, 'budget')
    expect(out.map((s) => s.id)).toEqual(['c'])
  })

  it('matches the Cyrillic text', () => {
    const out = filterSegments(SEGMENTS, 'сроках')
    expect(out.map((s) => s.id)).toEqual(['b'])
  })

  it('matches against the speaker name', () => {
    const out = filterSegments(SEGMENTS, 'charlie')
    expect(out.map((s) => s.id)).toEqual(['c'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterSegments(SEGMENTS, 'zzz-no-match')).toEqual([])
  })

  it('trims the query before matching', () => {
    const out = filterSegments(SEGMENTS, '  бюджет  ')
    expect(out.map((s) => s.id)).toEqual(['a'])
  })
})
