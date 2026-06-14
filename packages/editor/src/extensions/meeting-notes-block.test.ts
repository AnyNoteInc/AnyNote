import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

import {
  MEETING_NOTES_BLOCK_LABEL,
  MeetingNotesBlockSchema,
  createMeetingNotesBlockNode,
} from './meeting-notes-block.schema'

// Build a real prosemirror Schema from the Tiptap NodeSpec (the synced-block /
// embedded-database precedent — no live Editor needed). StarterKit supplies
// doc/paragraph/text. The load-bearing guarantee is that the SERVER extension set
// can resolve the node + serialize it to a static, non-interactive card (an
// unregistered custom node crashes the server `generateHTML` — it did for
// columnLayout before; see memory).
const schema = getSchema([StarterKit, MeetingNotesBlockSchema])

describe('meetingNotesBlock schema', () => {
  it('is an atom block referencing a meetingArtifactId', () => {
    const type = schema.nodes.meetingNotesBlock
    expect(type).toBeDefined()
    expect(type!.isAtom).toBe(true)
    expect(type!.isBlock).toBe(true)
  })

  it('round-trips the meetingArtifactId attr through node JSON', () => {
    const node = schema.nodeFromJSON({
      type: 'meetingNotesBlock',
      attrs: { meetingArtifactId: 'm1m2m3m4-0000-0000-0000-000000000000' },
    })
    expect(() => node.check()).not.toThrow()
    expect(node.attrs.meetingArtifactId).toBe('m1m2m3m4-0000-0000-0000-000000000000')
    expect(node.toJSON().attrs.meetingArtifactId).toBe('m1m2m3m4-0000-0000-0000-000000000000')
  })

  it('defaults meetingArtifactId to null', () => {
    const node = schema.nodes.meetingNotesBlock!.create()
    expect(node.attrs.meetingArtifactId).toBeNull()
  })

  it('builds a doc containing the node without throwing', () => {
    expect(() =>
      schema.nodeFromJSON({
        type: 'doc',
        content: [createMeetingNotesBlockNode('abc')],
      }),
    ).not.toThrow()
  })

  it('renders a labeled, NON-interactive card server-side (the export fallback)', () => {
    // The server-export path serializes the node via the schema spec's toDOM
    // (derived from the Tiptap renderHTML). Assert it carries the artifact id, the
    // «Запись встречи» label, and is a plain static <div> + <span> — no
    // editor/iframe/live-provider surface. toDOM avoids the jsdom dependency of
    // generateHTML (which needs `window`).
    const node = schema.nodeFromJSON({
      type: 'meetingNotesBlock',
      attrs: { meetingArtifactId: 'abc' },
    })
    const out = schema.nodes.meetingNotesBlock!.spec.toDOM!(node) as [
      string,
      Record<string, string>,
      [string, Record<string, string>, string],
    ]
    expect(out[0]).toBe('div')
    expect(out[1]['data-type']).toBe('meeting-notes-block')
    expect(out[1]['data-meeting-artifact-id']).toBe('abc')
    expect(out[2][0]).toBe('span')
    expect(out[2][2]).toBe(MEETING_NOTES_BLOCK_LABEL)
  })

  it('serializes an empty artifact id to a blank data attribute (no throw)', () => {
    const node = schema.nodes.meetingNotesBlock!.create()
    const out = schema.nodes.meetingNotesBlock!.spec.toDOM!(node) as [
      string,
      Record<string, string>,
      unknown,
    ]
    expect(out[1]['data-meeting-artifact-id']).toBe('')
  })
})

describe('createMeetingNotesBlockNode', () => {
  it('builds a meetingNotesBlock node JSON carrying the id', () => {
    const node = createMeetingNotesBlockNode('xyz')
    expect(node.type).toBe('meetingNotesBlock')
    expect(node.attrs.meetingArtifactId).toBe('xyz')
    expect(() => schema.nodeFromJSON(node).check()).not.toThrow()
  })
})
