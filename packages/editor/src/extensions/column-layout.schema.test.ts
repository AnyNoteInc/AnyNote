import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'

import { columnLayoutSpec, columnSpec } from './column-layout.schema'

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
    columnLayout: columnLayoutSpec,
    column: columnSpec,
  },
})

const paragraph = (text = 'hi') => schema.nodes.paragraph.create(null, schema.text(text))

const column = (...children: ReturnType<typeof paragraph>[]) =>
  schema.nodes.column.create(null, children)

const layout = (...cells: ReturnType<typeof column>[]) =>
  schema.nodes.columnLayout.create(null, cells)

describe('column-layout schema', () => {
  it('accepts a layout with 2 columns each containing a paragraph', () => {
    const doc = schema.nodes.doc.create(null, [layout(column(paragraph()), column(paragraph()))])
    expect(() => doc.check()).not.toThrow()
  })

  it('accepts a layout with 3 columns', () => {
    const doc = schema.nodes.doc.create(null, [
      layout(column(paragraph()), column(paragraph()), column(paragraph())),
    ])
    expect(() => doc.check()).not.toThrow()
  })

  it('accepts a layout with 4 columns (no upper cap)', () => {
    const doc = schema.nodes.doc.create(null, [
      layout(column(paragraph()), column(paragraph()), column(paragraph()), column(paragraph())),
    ])
    expect(() => doc.check()).not.toThrow()
  })

  it('accepts a layout with 6 columns (no upper cap)', () => {
    const doc = schema.nodes.doc.create(null, [
      layout(
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
      ),
    ])
    expect(() => doc.check()).not.toThrow()
  })

  it('rejects a layout with 0 columns', () => {
    expect(() => schema.nodes.columnLayout.createChecked(null, [])).toThrow()
  })

  it('rejects a column at the top level (must be inside layout)', () => {
    expect(() => schema.nodes.doc.createChecked(null, [column(paragraph())])).toThrow()
  })

  it('defaults column width to 1', () => {
    const node = column(paragraph())
    expect(node.attrs.width).toBe(1)
  })

  it('renders column with data-width and --column-width inline style', () => {
    const node = schema.nodes.column.create({ width: 1.5 }, [paragraph()])
    const dom = columnSpec.toDOM!(node) as [string, Record<string, string>, number]
    expect(dom[1]['data-width']).toBe('1.5')
    expect(dom[1].style).toContain('--column-width: 1.5')
  })

  it('parses width from data-width attribute', () => {
    // parseDOM rule shape: getAttrs reads element.getAttribute('data-width')
    const rule = columnSpec.parseDOM![0]!
    const fakeEl = { getAttribute: (key: string) => (key === 'data-width' ? '2.5' : null) }
    const attrs = (rule.getAttrs as (el: unknown) => Record<string, unknown>)(fakeEl)
    expect(attrs.width).toBe(2.5)
  })

  it('rejects a column with no children (block+ requires at least one)', () => {
    expect(() => schema.nodes.column.createChecked(null, [])).toThrow()
  })

  it('renders columnLayout as div[data-type=column-layout] with column count', () => {
    const node = layout(column(paragraph()), column(paragraph()))
    const dom = columnLayoutSpec.toDOM!(node) as [string, Record<string, string>, number]
    expect(dom[0]).toBe('div')
    expect(dom[1]['data-type']).toBe('column-layout')
    expect(dom[1]['data-columns']).toBe('2')
  })

  it('renders column as div[data-type=column]', () => {
    const node = column(paragraph())
    const dom = columnSpec.toDOM!(node) as [string, Record<string, string>, number]
    expect(dom[0]).toBe('div')
    expect(dom[1]['data-type']).toBe('column')
  })
})
