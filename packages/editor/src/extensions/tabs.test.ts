import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'

import {
  DEFAULT_TAB_LABEL,
  appendTabTransaction,
  clampActiveTab,
  createTabsContent,
  reconcileTabs,
  removeTabTransaction,
  tabSpec,
  tabsSpec,
} from './tabs.schema'

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
    tabs: tabsSpec,
    tab: tabSpec,
  },
})

const para = (text = '') =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : null)
const tab = (label: string, ...children: ReturnType<typeof para>[]) =>
  schema.nodes.tab.create({ label }, children.length ? children : [para()])
const tabsNode = (activeTab: number, ...tabChildren: ReturnType<typeof tab>[]) =>
  schema.nodes.tabs.create({ activeTab }, tabChildren)

const stateFrom = (...top: ReturnType<typeof tabsNode>[] | ReturnType<typeof para>[]) =>
  EditorState.create({ schema, doc: schema.nodes.doc.create(null, top) })

const firstTabs = (state: EditorState): { node: import('@tiptap/pm/model').Node; pos: number } => {
  let found: { node: import('@tiptap/pm/model').Node; pos: number } | null = null
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'tabs' && !found) {
      found = { node, pos }
      return false
    }
    return true
  })
  if (found === null) throw new Error('no tabs block found')
  return found
}

describe('tabs schema', () => {
  it('accepts a tabs block with two labeled tabs each holding a paragraph', () => {
    const doc = schema.nodes.doc.create(null, [
      tabsNode(0, tab('First', para('a')), tab('Second', para('b'))),
    ])
    expect(() => doc.check()).not.toThrow()
  })

  it('rejects a tabs block with 0 tabs', () => {
    expect(() => schema.nodes.tabs.createChecked({ activeTab: 0 }, [])).toThrow()
  })

  it('rejects a tab at the top level (must live inside tabs)', () => {
    expect(() => schema.nodes.doc.createChecked(null, [tab('orphan', para('x'))])).toThrow()
  })

  it('rejects a tab with no children (block+ requires at least one)', () => {
    expect(() => schema.nodes.tab.createChecked({ label: 'x' }, [])).toThrow()
  })

  it('defaults tab label to the default label and activeTab to 0', () => {
    const t = schema.nodes.tab.create(null, [para('a')])
    expect(t.attrs.label).toBe(DEFAULT_TAB_LABEL)
    const block = schema.nodes.tabs.create(null, [t])
    expect(block.attrs.activeTab).toBe(0)
  })

  it('round-trips through toDOM with data-active-tab / data-label', () => {
    const block = tabsNode(1, tab('Alpha', para('a')), tab('Beta', para('b')))
    const blockDom = tabsSpec.toDOM!(block) as [string, Record<string, string>, number]
    expect(blockDom[0]).toBe('div')
    expect(blockDom[1]['data-type']).toBe('tabs')
    expect(blockDom[1]['data-active-tab']).toBe('1')

    const tabDom = tabSpec.toDOM!(block.child(0)) as [string, Record<string, string>, number]
    expect(tabDom[1]['data-type']).toBe('tab')
    expect(tabDom[1]['data-label']).toBe('Alpha')
  })

  it('parses label/activeTab from data attributes', () => {
    const tabRule = tabSpec.parseDOM![0]!
    const fakeTab = { getAttribute: (k: string) => (k === 'data-label' ? 'Parsed' : null) }
    const tabAttrs = (tabRule.getAttrs as (el: unknown) => Record<string, unknown>)(fakeTab)
    expect(tabAttrs.label).toBe('Parsed')
  })
})

describe('clampActiveTab', () => {
  it('keeps an in-range index', () => {
    expect(clampActiveTab(1, 3)).toBe(1)
  })
  it('clamps a negative index to 0', () => {
    expect(clampActiveTab(-2, 3)).toBe(0)
  })
  it('clamps an over-range index to the last tab', () => {
    expect(clampActiveTab(9, 3)).toBe(2)
  })
  it('returns 0 for a 0-tab block', () => {
    expect(clampActiveTab(5, 0)).toBe(0)
  })
  it('truncates a fractional index', () => {
    expect(clampActiveTab(1.9, 3)).toBe(1)
  })
  it('returns 0 for a non-finite index', () => {
    expect(clampActiveTab(Number.NaN, 3)).toBe(0)
  })
})

describe('reconcileTabs (clamp + dissolve plugin)', () => {
  it('returns null when nothing needs reconciliation', () => {
    const state = stateFrom(tabsNode(1, tab('a', para('a')), tab('b', para('b'))))
    expect(reconcileTabs(state)).toBeNull()
  })

  it('clamps an out-of-range activeTab down to the last tab', () => {
    const state = stateFrom(tabsNode(5, tab('a', para('a')), tab('b', para('b'))))
    const tr = reconcileTabs(state)
    assertNonNull(tr)
    const next = state.apply(tr).doc
    expect(next.firstChild!.attrs.activeTab).toBe(1)
  })

  it('dissolves a 0-tab tabs block (the safety-net branch)', () => {
    // A 0-tab `tabs` block can't arise from a normal `tr.delete` — ProseMirror's
    // schema-fill keeps a placeholder tab. We build the malformed state directly
    // via unchecked `create` (the dissolve plugin is the backstop for a bad
    // paste / future edge) and assert reconcile removes the block, keeping the
    // surrounding paragraph.
    const emptyTabs = schema.nodes.tabs.create({ activeTab: 0 }, [])
    expect(emptyTabs.childCount).toBe(0)
    const doc = schema.nodes.doc.create(null, [para('keep'), emptyTabs])
    const state = EditorState.create({ schema, doc })
    const tr = reconcileTabs(state)
    assertNonNull(tr)
    const next = state.apply(tr).doc
    expect(next.childCount).toBe(1)
    expect(next.child(0).type.name).toBe('paragraph')
    expect(next.child(0).textContent).toBe('keep')
    next.descendants((node) => {
      expect(node.type.name).not.toBe('tabs')
      return true
    })
  })
})

describe('appendTabTransaction', () => {
  it('adds a new empty tab and activates it', () => {
    const state = stateFrom(tabsNode(0, tab('a', para('a')), tab('b', para('b'))))
    const entry = firstTabs(state)
    const tr = appendTabTransaction(state.tr, entry.pos)
    const next = state.apply(tr).doc
    const block = next.firstChild!
    expect(block.type.name).toBe('tabs')
    expect(block.childCount).toBe(3)
    expect(block.attrs.activeTab).toBe(2)
    // New tab holds a single empty paragraph.
    expect(block.child(2).childCount).toBe(1)
    expect(block.child(2).child(0).type.name).toBe('paragraph')
    expect(block.child(2).child(0).textContent).toBe('')
  })

  it('labels the new tab with a default numbered label', () => {
    const state = stateFrom(tabsNode(0, tab('a', para('a')), tab('b', para('b'))))
    const entry = firstTabs(state)
    const tr = appendTabTransaction(state.tr, entry.pos)
    const next = state.apply(tr).doc
    expect(next.firstChild!.child(2).attrs.label).toBe(`${DEFAULT_TAB_LABEL} 3`)
  })
})

describe('removeTabTransaction', () => {
  it('removes a non-last tab and clamps activeTab', () => {
    const state = stateFrom(
      tabsNode(2, tab('a', para('a')), tab('b', para('b')), tab('c', para('c'))),
    )
    const entry = firstTabs(state)
    const tr = removeTabTransaction(state.tr, entry.pos, 2)
    const next = state.apply(tr).doc
    const block = next.firstChild!
    expect(block.childCount).toBe(2)
    expect(block.child(0).attrs.label).toBe('a')
    expect(block.child(1).attrs.label).toBe('b')
    // activeTab was 2 (out of range now) → clamped to 1.
    expect(block.attrs.activeTab).toBe(1)
  })

  it('removing a middle tab preserves the others in order', () => {
    const state = stateFrom(
      tabsNode(0, tab('a', para('a')), tab('b', para('b')), tab('c', para('c'))),
    )
    const entry = firstTabs(state)
    const tr = removeTabTransaction(state.tr, entry.pos, 1)
    const next = state.apply(tr).doc
    const block = next.firstChild!
    expect(block.childCount).toBe(2)
    expect(block.child(0).attrs.label).toBe('a')
    expect(block.child(1).attrs.label).toBe('c')
  })

  it('removing the last remaining tab dissolves the whole block', () => {
    const state = stateFrom(tabsNode(0, tab('only', para('a'))))
    const entry = firstTabs(state)
    const tr = removeTabTransaction(state.tr, entry.pos, 0)
    const next = state.apply(tr).doc
    next.descendants((node) => {
      expect(node.type.name).not.toBe('tabs')
      return true
    })
  })
})

describe('createTabsContent', () => {
  it('builds a tabs block with two labeled starter tabs (each an empty paragraph)', () => {
    const content = createTabsContent()
    expect(content.type).toBe('tabs')
    expect(content.attrs.activeTab).toBe(0)
    expect(content.content).toHaveLength(2)
    expect(content.content[0]!.attrs.label).toBe('Вкладка 1')
    expect(content.content[1]!.attrs.label).toBe('Вкладка 2')
    expect(content.content[0]!.content[0]!.type).toBe('paragraph')
  })

  it('produces content that the schema accepts', () => {
    const content = createTabsContent()
    const node = schema.nodeFromJSON(content)
    expect(() => node.check()).not.toThrow()
    expect(node.type.name).toBe('tabs')
    expect(node.childCount).toBe(2)
  })
})
