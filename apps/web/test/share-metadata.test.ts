import { describe, expect, it } from 'vitest'

import { shareRobots } from '@/lib/share-metadata'

describe('shareRobots', () => {
  it('indexes a published SITE that allows indexing', () => {
    expect(shareRobots({ mode: 'SITE', published: true, allowIndexing: true })).toEqual({
      index: true,
    })
  })

  it('does not index a SITE that disallows indexing', () => {
    expect(shareRobots({ mode: 'SITE', published: true, allowIndexing: false })).toEqual({
      index: false,
    })
  })

  it('does not index an unpublished SITE even with indexing allowed', () => {
    expect(shareRobots({ mode: 'SITE', published: false, allowIndexing: true })).toEqual({
      index: false,
    })
  })

  it('never indexes LINK mode', () => {
    expect(shareRobots({ mode: 'LINK', published: true, allowIndexing: true })).toEqual({
      index: false,
    })
    expect(shareRobots({ mode: 'LINK', published: false, allowIndexing: false })).toEqual({
      index: false,
    })
  })
})
