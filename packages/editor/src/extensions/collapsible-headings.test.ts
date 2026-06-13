import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  collapseKey,
  collapsedPrefKey,
  deriveHeadingEntries,
  hiddenNodeRanges,
  readCollapsed,
  sectionRange,
  writeCollapsed,
} from './collapsible-headings'

// A real ProseMirror schema (the same nodes the live editor registers) so the
// section-range computer is exercised against real positions, not a hand-rolled
// position model. StarterKit gives us doc/heading/paragraph/bulletList/etc.
// Docs are built via nodeFromJSON (the media.test.ts idiom) so we don't poke at
// the possibly-undefined `schema.nodes[x]` index signature.
const schema = getSchema([StarterKit])

type JSONNode = { type: string; text?: string; attrs?: Record<string, unknown>; content?: JSONNode[] }

const textContent = (text: string): JSONNode[] => (text ? [{ type: 'text', text }] : [])
// `heading`/`para` are JSON building blocks; `doc` resolves them into a real
// PMNode so we never poke the possibly-undefined `schema.nodes[x]` accessor.
const heading = (level: number, text: string): JSONNode => ({
  type: 'heading',
  attrs: { level },
  content: textContent(text),
})
const para = (text: string): JSONNode => ({ type: 'paragraph', content: textContent(text) })
const doc = (...children: JSONNode[]): PMNode => schema.nodeFromJSON({ type: 'doc', content: children })

// Resolve the top-level position of the Nth child (the pos passed to a node
// decoration / where a heading sits in the doc).
const childPos = (d: PMNode, index: number): number => {
  let pos = 0
  for (let i = 0; i < index; i++) pos += d.child(i).nodeSize
  return pos
}

describe('collapseKey', () => {
  it('combines level, text and ordinal so same-text headings at different levels differ', () => {
    expect(collapseKey(2, 'Overview', 0)).not.toBe(collapseKey(3, 'Overview', 0))
  })

  it('disambiguates repeated identical headings by ordinal', () => {
    expect(collapseKey(2, 'Notes', 0)).not.toBe(collapseKey(2, 'Notes', 1))
  })

  it('is stable for the same (level, text, ordinal)', () => {
    expect(collapseKey(1, 'Title', 0)).toBe(collapseKey(1, 'Title', 0))
  })

  it('normalizes whitespace in the text so cosmetic changes do not reset state', () => {
    expect(collapseKey(2, '  Hello   world  ', 0)).toBe(collapseKey(2, 'Hello world', 0))
  })
})

describe('deriveHeadingEntries', () => {
  it('returns one entry per heading with pos, level, text and an ordinal-stable key', () => {
    const d = doc(heading(2, 'A'), para('x'), heading(2, 'B'), para('y'))
    const entries = deriveHeadingEntries(d)
    expect(entries.map((e) => e.level)).toEqual([2, 2])
    expect(entries.map((e) => e.text)).toEqual(['A', 'B'])
    expect(entries[0]!.pos).toBe(childPos(d, 0))
    expect(entries[1]!.pos).toBe(childPos(d, 2))
    // Distinct text → distinct keys.
    expect(new Set(entries.map((e) => e.key)).size).toBe(2)
  })

  it('assigns increasing ordinals to identical (level,text) headings so keys stay unique', () => {
    const d = doc(heading(2, 'Same'), para('a'), heading(2, 'Same'), para('b'))
    const entries = deriveHeadingEntries(d)
    expect(entries.map((e) => e.ordinal)).toEqual([0, 1])
    expect(new Set(entries.map((e) => e.key)).size).toBe(2)
  })

  it('ignores non-heading nodes', () => {
    const d = doc(para('a'), para('b'))
    expect(deriveHeadingEntries(d)).toEqual([])
  })
})

describe('sectionRange', () => {
  it('spans from after the heading to the next same-level heading (h2 → paras → h2)', () => {
    const d = doc(heading(2, 'A'), para('x'), para('y'), heading(2, 'B'), para('z'))
    const headingPos = childPos(d, 0)
    const afterHeading = headingPos + d.child(0).nodeSize
    const nextHeadingPos = childPos(d, 3)
    expect(sectionRange(d, headingPos)).toEqual({ from: afterHeading, to: nextHeadingPos })
  })

  it('stops at a HIGHER-level heading (h2 closes at the following h1)', () => {
    const d = doc(para('intro'), heading(2, 'sub'), para('x'), heading(1, 'top'), para('y'))
    const headingPos = childPos(d, 1)
    const afterHeading = headingPos + d.child(1).nodeSize
    const h1Pos = childPos(d, 3)
    expect(sectionRange(d, headingPos)).toEqual({ from: afterHeading, to: h1Pos })
  })

  it('INCLUDES a deeper-level heading and its content (h1 owns a nested h2)', () => {
    const d = doc(heading(1, 'top'), heading(2, 'sub'), para('content'), heading(1, 'next'))
    const headingPos = childPos(d, 0)
    const afterHeading = headingPos + d.child(0).nodeSize
    const nextH1Pos = childPos(d, 3)
    // The whole [sub, content] block belongs to the h1 section.
    expect(sectionRange(d, headingPos)).toEqual({ from: afterHeading, to: nextH1Pos })
  })

  it('runs to the end of the doc for a trailing heading with following content but no later heading', () => {
    const d = doc(para('intro'), heading(2, 'last'), para('a'), para('b'))
    const headingPos = childPos(d, 1)
    const afterHeading = headingPos + d.child(1).nodeSize
    expect(sectionRange(d, headingPos)).toEqual({ from: afterHeading, to: d.content.size })
  })

  it('is an empty range for a trailing heading with NO following content', () => {
    const d = doc(para('intro'), heading(2, 'last'))
    const headingPos = childPos(d, 1)
    const afterHeading = headingPos + d.child(1).nodeSize
    const range = sectionRange(d, headingPos)
    expect(range.from).toBe(afterHeading)
    expect(range.to).toBe(afterHeading)
    expect(range.to - range.from).toBe(0)
  })
})

describe('hiddenNodeRanges', () => {
  it('returns the per-node ranges inside the collapsed section (each node hidden individually)', () => {
    const d = doc(heading(2, 'A'), para('x'), para('y'), heading(2, 'B'), para('z'))
    const keyA = deriveHeadingEntries(d)[0]!.key
    const ranges = hiddenNodeRanges(d, new Set([keyA]))
    // The two paragraphs between the two h2s — each as its own range.
    const p1 = childPos(d, 1)
    const p2 = childPos(d, 2)
    expect(ranges).toEqual([
      { from: p1, to: p1 + d.child(1).nodeSize },
      { from: p2, to: p2 + d.child(2).nodeSize },
    ])
  })

  it('hides a nested deeper heading and its content too (h1 collapsed swallows its h2)', () => {
    const d = doc(heading(1, 'top'), heading(2, 'sub'), para('content'), heading(1, 'next'))
    const keyTop = deriveHeadingEntries(d)[0]!.key
    const ranges = hiddenNodeRanges(d, new Set([keyTop]))
    const subPos = childPos(d, 1)
    const contentPos = childPos(d, 2)
    expect(ranges).toEqual([
      { from: subPos, to: subPos + d.child(1).nodeSize },
      { from: contentPos, to: contentPos + d.child(2).nodeSize },
    ])
  })

  it('returns nothing when no keys are collapsed', () => {
    const d = doc(heading(2, 'A'), para('x'))
    expect(hiddenNodeRanges(d, new Set())).toEqual([])
  })

  it('returns nothing for a collapsed key that no longer matches any heading', () => {
    const d = doc(heading(2, 'A'), para('x'))
    expect(hiddenNodeRanges(d, new Set(['stale-key']))).toEqual([])
  })

  it('collapsing a heading NEVER changes the document (display-only)', () => {
    const d = doc(heading(2, 'A'), para('x'), para('y'), heading(2, 'B'), para('z'))
    const before = JSON.stringify(d.toJSON())
    const keyA = deriveHeadingEntries(d)[0]!.key
    hiddenNodeRanges(d, new Set([keyA]))
    // The doc JSON is byte-identical: collapse computes ranges, it never mutates.
    expect(JSON.stringify(d.toJSON())).toBe(before)
  })
})

// --- localStorage round-trip (the embed-prefs.test.ts shim idiom) ----------

class MemStorage {
  private readonly m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}

const g = globalThis as unknown as { localStorage?: Storage }
let restore: (() => void) | null = null

beforeAll(() => {
  const prev = g.localStorage
  g.localStorage = new MemStorage() as unknown as Storage
  restore = () => {
    if (prev === undefined) delete g.localStorage
    else g.localStorage = prev
  }
})

afterAll(() => restore?.())

describe('collapsedPrefKey', () => {
  it('namespaces by pageId', () => {
    expect(collapsedPrefKey('page-9')).toBe('anynote:collapsed:page-9')
  })
})

describe('readCollapsed / writeCollapsed round-trip', () => {
  beforeEach(() => g.localStorage!.clear())

  it('defaults to an empty set when nothing is stored', () => {
    expect(readCollapsed('p1')).toEqual(new Set())
  })

  it('round-trips a set of keys', () => {
    writeCollapsed('p1', new Set(['k1', 'k2']))
    expect(readCollapsed('p1')).toEqual(new Set(['k1', 'k2']))
  })

  it('serializes as a JSON array (stable, inspectable)', () => {
    writeCollapsed('p1', new Set(['a', 'b']))
    expect(JSON.parse(g.localStorage!.getItem('anynote:collapsed:p1')!)).toEqual(['a', 'b'])
  })

  it('removes the key entirely when the set is empty (no orphan empty arrays)', () => {
    writeCollapsed('p1', new Set(['x']))
    writeCollapsed('p1', new Set())
    expect(g.localStorage!.getItem('anynote:collapsed:p1')).toBeNull()
    expect(readCollapsed('p1')).toEqual(new Set())
  })

  it('returns an empty set when the stored value is malformed', () => {
    g.localStorage!.setItem('anynote:collapsed:p1', '{not json')
    expect(readCollapsed('p1')).toEqual(new Set())
  })

  it('returns an empty set when localStorage throws (SSR / privacy mode)', () => {
    const spy = vi.spyOn(g.localStorage!, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readCollapsed('p1')).toEqual(new Set())
    spy.mockRestore()
  })

  it('swallows write errors (privacy mode)', () => {
    const spy = vi.spyOn(g.localStorage!, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeCollapsed('p1', new Set(['x']))).not.toThrow()
    spy.mockRestore()
  })
})
