import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodeAnchor, decodeAnchor } from './comment-anchor'

// Verifies the base64 RelativePosition codec is a faithful round-trip and that
// a relative position tracks insertions before it (Yjs RelativePosition semantics).
describe('comment-anchor codec', () => {
  it('round-trips a RelativePosition through base64', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'hello world')
    const rel = Y.createRelativePositionFromTypeIndex(text, 6) // before "world"
    const encoded = encodeAnchor(rel)
    expect(typeof encoded).toBe('string')
    const back = decodeAnchor(encoded)
    const abs = Y.createAbsolutePositionFromRelativePosition(back, doc)
    expect(abs?.index).toBe(6)
  })

  it('relative position shifts when earlier text is inserted', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'world')
    const rel = Y.createRelativePositionFromTypeIndex(text, 5) // end
    text.insert(0, 'hello ') // 6 chars before
    const abs = Y.createAbsolutePositionFromRelativePosition(decodeAnchor(encodeAnchor(rel)), doc)
    expect(abs?.index).toBe(11)
  })
})
