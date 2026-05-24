import { describe, expect, it } from 'vitest'

import { finalizeDrawioSave } from './drawio-save'

describe('finalizeDrawioSave', () => {
  it('prefers the latest autosaved xml and uses the exported svg', () => {
    expect(
      finalizeDrawioSave({
        latestXml: '<b/>',
        initialXml: '<a/>',
        exportData: 'data:image/svg+xml,b',
      }),
    ).toEqual({ xml: '<b/>', svg: 'data:image/svg+xml,b' })
  })

  it('falls back to the initial xml when nothing changed', () => {
    expect(
      finalizeDrawioSave({
        latestXml: '',
        initialXml: '<a/>',
        exportData: 'data:image/svg+xml,a',
      }),
    ).toEqual({ xml: '<a/>', svg: 'data:image/svg+xml,a' })
  })
})
