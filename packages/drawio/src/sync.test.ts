import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { writeXmlToYText } from './sync'

describe('writeXmlToYText', () => {
  it('replaces the entire Y.Text content', () => {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('drawio')
    writeXmlToYText(ydoc, ytext, '<mxfile>a</mxfile>')
    expect(ytext.toString()).toBe('<mxfile>a</mxfile>')
    writeXmlToYText(ydoc, ytext, '<mxfile>b</mxfile>')
    expect(ytext.toString()).toBe('<mxfile>b</mxfile>')
  })

  it('writes in a local transaction so the reload observer can skip it', () => {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('drawio')
    const localFlags: boolean[] = []
    ytext.observe((_event, tx) => localFlags.push(tx.local))
    writeXmlToYText(ydoc, ytext, '<mxfile/>')
    expect(localFlags).toEqual([true])
  })
})
