import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

/** Args handed to the host when the space trigger fires (spec §3.1). */
export type SpaceAiTriggerArgs = {
  /** Caret position inside the empty paragraph at trigger time. */
  pos: number
  /** Caret rect resolver for anchoring the AI bar (re-read at render time).
   *  Returns a zero rect if the position is gone; callers may treat
   *  width+height 0 as unanchored. */
  getRect: () => DOMRect
}

type SpaceAiStorageAi = {
  onSpaceAi?: (args: SpaceAiTriggerArgs) => void
}

/**
 * Pure guard: Space opens the AI bar ONLY on an empty top-level paragraph with
 * a caret (spec §3.1). Shift+Space is not bound — it types a plain space
 * (Notion's documented bypass). Nested blocks (details/callout/table cells)
 * never trigger (depth !== 1).
 */
export function findSpaceAiTrigger(state: EditorState): { pos: number } | null {
  const { selection } = state
  if (!selection.empty) return null
  const $from = selection.$from
  if ($from.depth !== 1) return null
  const parent = $from.parent
  if (parent.type.name !== 'paragraph') return null
  if (parent.content.size !== 0) return null
  return { pos: $from.pos }
}

export const SpaceAI = Extension.create({
  name: 'spaceAi',

  addKeyboardShortcuts() {
    return {
      // Bare Space only — prosemirror-keymap matches modifiers exactly, so
      // Shift+Space falls through to the default space insertion.
      Space: () => {
        const editor = this.editor
        if (!editor.isEditable) return false
        const ai = (editor.storage as unknown as { ai?: SpaceAiStorageAi }).ai
        const onSpaceAi = ai?.onSpaceAi
        if (!onSpaceAi) return false
        const trigger = findSpaceAiTrigger(editor.state)
        if (!trigger) return false
        const getRect = () => {
          try {
            const coords = editor.view.coordsAtPos(trigger.pos)
            return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
          } catch {
            return new DOMRect(0, 0, 0, 0)
          }
        }
        onSpaceAi({ pos: trigger.pos, getRect })
        return true // consume the keypress — no space is typed
      },
    }
  },
})
