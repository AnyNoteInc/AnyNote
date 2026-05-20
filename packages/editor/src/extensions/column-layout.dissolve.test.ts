import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'

import { columnLayoutSpec, columnSpec } from './column-layout.schema'
import { dissolveColumnLayouts } from './column-layout.dissolve'

function assertNonNull<T>(value: T | null): asserts value is T {
  if (value === null) throw new Error('expected non-null value')
}

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    toggle: {
      group: 'block',
      content: 'block+',
      attrs: { open: { default: true } },
      parseDOM: [{ tag: 'div[data-type="toggle"]' }],
      toDOM: () => ['div', { 'data-type': 'toggle' }, 0],
    },
    columnLayout: columnLayoutSpec,
    column: columnSpec,
  },
})

const para = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)
const col = (...children: ReturnType<typeof para>[]) => schema.nodes.column.create(null, children)
const lay = (...cells: ReturnType<typeof col>[]) =>
  schema.nodes.columnLayout.create({ columns: cells.length }, cells)
const toggle = (...children: Array<ReturnType<typeof para> | ReturnType<typeof lay>>) =>
  schema.nodes.toggle.create({ open: true }, children)

const stateFrom = (
  ...top: Array<ReturnType<typeof para> | ReturnType<typeof lay> | ReturnType<typeof toggle>>
) =>
  EditorState.create({ schema, doc: schema.nodes.doc.create(null, top) })

describe('dissolveColumnLayouts', () => {
  it('returns null when no layouts need dissolution', () => {
    const state = stateFrom(lay(col(para('a')), col(para('b'))))
    expect(dissolveColumnLayouts(state)).toBeNull()
  })

  it('unwraps a 1-column layout, lifting its children to top level', () => {
    const state = stateFrom(lay(col(para('a'), para('b'))))
    const tr = dissolveColumnLayouts(state)
    assertNonNull(tr)
    const next = state.apply(tr).doc
    expect(next.childCount).toBe(2)
    expect(next.child(0).type.name).toBe('paragraph')
    expect(next.child(0).textContent).toBe('a')
    expect(next.child(1).textContent).toBe('b')
  })

  it('leaves a 3-column layout alone when every cell has content', () => {
    const state = stateFrom(lay(col(para('a')), col(para('b')), col(para('c'))))
    expect(dissolveColumnLayouts(state)).toBeNull()
  })

  it('removes an empty middle column from a 3-column layout', () => {
    const state = stateFrom(lay(col(para('a')), col(para('')), col(para('c'))))
    const tr = dissolveColumnLayouts(state)
    assertNonNull(tr)
    const next = state.apply(tr).doc
    const layout = next.firstChild!
    expect(layout.type.name).toBe('columnLayout')
    expect(layout.childCount).toBe(2)
    expect(layout.child(0).textContent).toBe('a')
    expect(layout.child(1).textContent).toBe('c')
  })

  it('removes an empty middle column from a 4-column layout', () => {
    const state = stateFrom(lay(col(para('a')), col(para('')), col(para('c')), col(para('d'))))
    const tr = dissolveColumnLayouts(state)
    assertNonNull(tr)
    const next = state.apply(tr).doc
    const layout = next.firstChild!
    expect(layout.type.name).toBe('columnLayout')
    expect(layout.childCount).toBe(3)
    expect(layout.child(0).textContent).toBe('a')
    expect(layout.child(1).textContent).toBe('c')
    expect(layout.child(2).textContent).toBe('d')
  })

  it('leaves a 5-column layout alone when every cell has content', () => {
    const state = stateFrom(
      lay(col(para('a')), col(para('b')), col(para('c')), col(para('d')), col(para('e'))),
    )
    expect(dissolveColumnLayouts(state)).toBeNull()
  })

  it('removes empty columns and may unwrap if only 1 non-empty remains', () => {
    // Build a layout with one cell that has zero children. Schema doesn't
    // allow this at create time, but a transaction can produce a transient
    // invalid state mid-update — we simulate it by removing children via tr.
    const original = stateFrom(lay(col(para('a')), col(para('b'))))
    // Programmatically remove the second column's paragraph:
    const tr = original.tr
    const layoutNode = original.doc.firstChild!
    const secondCol = layoutNode.child(1)
    const secondColStart = 1 + layoutNode.child(0).nodeSize + 1
    tr.delete(secondColStart, secondColStart + secondCol.child(0).nodeSize)
    const intermediate = original.apply(tr)

    const dissolveTr = dissolveColumnLayouts(intermediate)
    assertNonNull(dissolveTr)
    const next = intermediate.apply(dissolveTr).doc
    // Empty column removed → only 1 non-empty column → unwrap → top-level paragraph
    expect(next.childCount).toBe(1)
    expect(next.child(0).type.name).toBe('paragraph')
    expect(next.child(0).textContent).toBe('a')
  })

  it('unwraps a nested layout inside a toggle after one column becomes empty', () => {
    const original = stateFrom(toggle(lay(col(para('left')), col(para('right')))))
    const tr = original.tr
    const toggleNode = original.doc.firstChild!
    const layoutNode = toggleNode.firstChild!
    const secondCol = layoutNode.child(1)
    const layoutStart = 1
    const secondColStart = layoutStart + 1 + layoutNode.child(0).nodeSize + 1
    tr.delete(secondColStart, secondColStart + secondCol.child(0).nodeSize)
    const intermediate = original.apply(tr)

    const dissolveTr = dissolveColumnLayouts(intermediate)
    assertNonNull(dissolveTr)
    const next = intermediate.apply(dissolveTr).doc
    const nextToggle = next.firstChild!
    expect(nextToggle.type.name).toBe('toggle')
    expect(nextToggle.childCount).toBe(1)
    expect(nextToggle.firstChild?.type.name).toBe('paragraph')
    expect(nextToggle.firstChild?.textContent).toBe('left')
  })

  it('replaces a fully empty only-child layout with an empty paragraph', () => {
    const state = stateFrom(lay(col(para('')), col(para(''))))
    const dissolveTr = dissolveColumnLayouts(state)
    assertNonNull(dissolveTr)
    const next = state.apply(dissolveTr).doc
    expect(next.childCount).toBe(1)
    expect(next.child(0).type.name).toBe('paragraph')
    expect(next.child(0).textContent).toBe('')
  })
})
