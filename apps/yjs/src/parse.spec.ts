import { describe, expect, it } from '@jest/globals'

import { parseDocumentName, SYNCED_BLOCK_PREFIX } from './parse.js'

describe('parseDocumentName', () => {
  it('treats a bare uuid as a page document', () => {
    const id = '11111111-1111-7111-8111-111111111111'
    expect(parseDocumentName(id)).toEqual({ kind: 'page', id })
  })

  it('treats any non-prefixed name as a page document (the raw documentName is the pageId)', () => {
    expect(parseDocumentName('not-a-uuid-but-still-a-page')).toEqual({
      kind: 'page',
      id: 'not-a-uuid-but-still-a-page',
    })
  })

  it('parses a syncedBlock:<uuid> name into a syncedBlock document with the bare id', () => {
    const id = '22222222-2222-7222-8222-222222222222'
    expect(parseDocumentName(`${SYNCED_BLOCK_PREFIX}${id}`)).toEqual({ kind: 'syncedBlock', id })
  })

  it('exposes the canonical prefix as syncedBlock:', () => {
    expect(SYNCED_BLOCK_PREFIX).toBe('syncedBlock:')
  })

  it('strips only the first prefix occurrence (the id keeps any trailing colons)', () => {
    expect(parseDocumentName('syncedBlock:a:b')).toEqual({ kind: 'syncedBlock', id: 'a:b' })
  })

  it('treats a bare "syncedBlock:" with an empty id still as a syncedBlock kind (id empty)', () => {
    expect(parseDocumentName('syncedBlock:')).toEqual({ kind: 'syncedBlock', id: '' })
  })
})
