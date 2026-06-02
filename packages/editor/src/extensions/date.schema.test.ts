import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { Node } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { formatIsoForDisplay } from '../lib/date-format'
import { DateSchema } from './date.schema'

// Compile the real DateSchema (its renderHTML/parseHTML) into a prosemirror
// schema alongside StarterKit (provides doc/paragraph/text). We then exercise
// the COMPILED spec's toDOM/parseDOM — i.e. the actual production code path,
// not a hand-written duplicate.
const schema = getSchema([StarterKit, DateSchema])
// Non-null: DateSchema registers the `date` node, so it is always in the schema.
const dateType = schema.nodes.date!

type DomOutputArray = [string, Record<string, string>, string]

const toDom = (node: Node): DomOutputArray => {
  if (!dateType.spec.toDOM) throw new Error('DateSchema has no toDOM')
  return dateType.spec.toDOM(node) as DomOutputArray
}

describe('DateSchema', () => {
  it('renders a date node to a span with readable text and data attrs', () => {
    const node = dateType.create({ value: '2026-06-02', kind: 'date' })
    const dom = toDom(node)
    expect(dom[0]).toBe('span')
    expect(dom[1]['data-type']).toBe('date')
    expect(dom[1]['data-value']).toBe('2026-06-02')
    expect(dom[1]['data-kind']).toBe('date')
    expect(dom[2]).toBe('02.06.2026')
  })

  it('renders a datetime node with date and time (TZ-safe)', () => {
    const iso = '2026-06-02T08:30:00'
    const node = dateType.create({ value: iso, kind: 'datetime' })
    const dom = toDom(node)
    expect(dom[1]['data-kind']).toBe('datetime')
    expect(dom[2]).toBe(formatIsoForDisplay(iso, 'datetime'))
  })

  it('falls back to raw value for an unparseable iso string', () => {
    const node = dateType.create({ value: 'not-a-date', kind: 'date' })
    expect(toDom(node)[2]).toBe('not-a-date')
  })

  it('parses data-value and data-kind from a matching span', () => {
    const rule = (dateType.spec.parseDOM ?? []).find((r) => r.tag === 'span[data-type="date"]')
    expect(rule).toBeDefined()
    const fakeEl = {
      getAttribute: (key: string) =>
        key === 'data-value' ? '2026-06-02' : key === 'data-kind' ? 'datetime' : null,
    }
    const parsed = (rule!.getAttrs as (el: unknown) => Record<string, unknown>)(fakeEl)
    expect(parsed.value).toBe('2026-06-02')
    expect(parsed.kind).toBe('datetime')
  })

  it('defaults kind to "date" when data-kind is absent or unrecognized', () => {
    const rule = (dateType.spec.parseDOM ?? []).find((r) => r.tag === 'span[data-type="date"]')
    const getAttrs = rule!.getAttrs as (el: unknown) => Record<string, unknown>
    const elWithoutKind = { getAttribute: (key: string) => (key === 'data-value' ? '2026-06-02' : null) }
    const elWithGarbageKind = {
      getAttribute: (key: string) =>
        key === 'data-value' ? '2026-06-02' : key === 'data-kind' ? 'nonsense' : null,
    }
    expect(getAttrs(elWithoutKind).kind).toBe('date')
    expect(getAttrs(elWithGarbageKind).kind).toBe('date')
  })
})
