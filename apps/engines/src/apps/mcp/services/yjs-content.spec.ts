import { describe, it, expect } from '@jest/globals'
import { TiptapTransformer } from '@hocuspocus/transformer'

import { CONTENT_EXTENSIONS } from './content-yjs.js'
import {
  computeTargetDoc,
  prepareDocUpdate,
  readTiptapDoc,
  type TiptapDoc,
} from './yjs-content.js'

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

function makeLiveDoc(doc: TiptapDoc) {
  return TiptapTransformer.toYdoc(doc, 'default', CONTENT_EXTENSIONS)
}

describe('computeTargetDoc', () => {
  it('append concatenates content and starts from an empty doc when current is null', () => {
    const { doc } = computeTargetDoc(null, {
      kind: 'append',
      doc: { type: 'doc', content: [para('a')] },
    })
    expect(doc.content).toHaveLength(1)

    const appended = computeTargetDoc(
      { type: 'doc', content: [para('a')] },
      { kind: 'append', doc: { type: 'doc', content: [para('b')] } },
    )
    expect(appended.doc.content).toHaveLength(2)
  })

  it('replaceText: first-only vs all, counted per occurrence', () => {
    const current: TiptapDoc = { type: 'doc', content: [para('пар пар пар'), para('пар')] }

    const first = computeTargetDoc(current, {
      kind: 'replaceText',
      find: 'пар',
      replace: 'жар',
      all: false,
    })
    expect(first.replacements).toBe(1)
    expect(JSON.stringify(first.doc)).toContain('жар пар пар')

    const all = computeTargetDoc(current, {
      kind: 'replaceText',
      find: 'пар',
      replace: 'жар',
      all: true,
    })
    expect(all.replacements).toBe(4)
    expect(JSON.stringify(all.doc)).not.toContain('пар')
  })

  it('replaceText returns 0 without touching the doc when nothing matches', () => {
    const current: TiptapDoc = { type: 'doc', content: [para('текст')] }
    const result = computeTargetDoc(current, {
      kind: 'replaceText',
      find: 'нет',
      replace: 'x',
      all: true,
    })
    expect(result.replacements).toBe(0)
    expect(result.doc).toBe(current)
  })
})

describe('prepareDocUpdate on a live Y.Doc', () => {
  it('append diffs into the existing fragment and round-trips', () => {
    const ydoc = makeLiveDoc({ type: 'doc', content: [para('первый')] })
    const { doc: target } = computeTargetDoc(readTiptapDoc(ydoc), {
      kind: 'append',
      doc: { type: 'doc', content: [para('второй')] },
    })

    prepareDocUpdate(target)(ydoc)

    const roundTripped = readTiptapDoc(ydoc)
    expect(JSON.stringify(roundTripped)).toContain('первый')
    expect(JSON.stringify(roundTripped)).toContain('второй')
    expect(roundTripped.content).toHaveLength(2)
  })

  it('replaceAll rewrites the fragment content', () => {
    const ydoc = makeLiveDoc({ type: 'doc', content: [para('старое'), para('содержимое')] })

    prepareDocUpdate({ type: 'doc', content: [para('новое')] })(ydoc)

    const roundTripped = readTiptapDoc(ydoc)
    expect(roundTripped.content).toHaveLength(1)
    expect(JSON.stringify(roundTripped)).toContain('новое')
    expect(JSON.stringify(roundTripped)).not.toContain('старое')
  })

  it('replaceText edits survive the Y round-trip', () => {
    const ydoc = makeLiveDoc({ type: 'doc', content: [para('русская баня')] })
    const { doc: target, replacements } = computeTargetDoc(readTiptapDoc(ydoc), {
      kind: 'replaceText',
      find: 'баня',
      replace: 'сауна',
      all: true,
    })
    expect(replacements).toBe(1)

    prepareDocUpdate(target)(ydoc)

    expect(JSON.stringify(readTiptapDoc(ydoc))).toContain('русская сауна')
  })

  it('prepareDocUpdate throws on schema-invalid docs BEFORE mutating', () => {
    expect(() =>
      prepareDocUpdate({ type: 'doc', content: [{ type: 'no-such-node' }] }),
    ).toThrow()
  })
})
