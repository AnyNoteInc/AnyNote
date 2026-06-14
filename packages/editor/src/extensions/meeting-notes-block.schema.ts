import { Node, mergeAttributes } from '@tiptap/core'

// Schema-only definition of the `meetingNotesBlock` node. It is an ATOM block
// that references a `MeetingArtifact` by id; the live summary/transcript live in
// the MEETING page the artifact owns (NOT in the host page doc). The schema lives
// here (no React, no MUI, no tRPC) so it can be registered in BOTH the client
// `buildExtensions` (index.ts) AND the server `buildServerExtensions` (server.ts).
// Registering it server-side is load-bearing: `generateHTML` / template-preview
// walks the doc with the server extension set, and an unregistered custom node
// makes it throw (the columnLayout production-crash precedent — see
// embedded-database.schema.ts header).
//
// The server renderHTML is NEVER interactive (PDF/HTML can't reach the live
// MEETING page): it renders a labeled static card («Запись встречи») + a link to
// the meeting. The live access-checked summary card is mounted ONLY by the client
// node view (meeting-notes-block.tsx), which apps/web injects via the
// `renderMeetingBlock` option.
export type MeetingNotesBlockAttrs = {
  meetingArtifactId: string | null
}

export const MEETING_NOTES_BLOCK_LABEL = 'Запись встречи'

export const MeetingNotesBlockSchema = Node.create({
  name: 'meetingNotesBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      meetingArtifactId: {
        default: null,
        parseHTML: (element) =>
          element instanceof HTMLElement
            ? element.getAttribute('data-meeting-artifact-id') || null
            : null,
        renderHTML: (attrs) => {
          const id = (attrs as MeetingNotesBlockAttrs).meetingArtifactId
          return id ? { 'data-meeting-artifact-id': id } : {}
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="meeting-notes-block"]',
      },
    ]
  },

  // Static, NON-interactive fallback for SSR/export contexts that don't run the
  // React node view (PDF/HTML export). The live summary card replaces this in app.
  // The card carries the artifact id + a labeled «Запись встречи» heading and a
  // link to the meeting — NEVER an iframe/live provider (export can't reach it).
  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as MeetingNotesBlockAttrs
    const id = attrs.meetingArtifactId ?? ''
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'meeting-notes-block',
        'data-meeting-artifact-id': id,
        class: 'anynote-meeting-notes-block',
      }),
      ['span', { class: 'anynote-meeting-notes-block__label' }, MEETING_NOTES_BLOCK_LABEL],
    ]
  },
})

// ---------------------------------------------------------------------------
// Pure helpers (no React, no Tiptap Editor) — tested in meeting-notes-block.test.ts
// and used by the meeting-notes-block.tsx node view / app wiring.
// ---------------------------------------------------------------------------

/**
 * The node JSON inserted into the host page doc once a MeetingArtifact id is
 * known. Shared by the slash «Запись встречи» insert flow + tests so the shape
 * can't drift.
 */
export function createMeetingNotesBlockNode(meetingArtifactId: string) {
  return { type: 'meetingNotesBlock', attrs: { meetingArtifactId } }
}
