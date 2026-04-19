import { Extension } from "@tiptap/core"

import type { BackgroundColorKey } from "../lib/color-palette"
import { BACKGROUND_COLOR_KEYS } from "../lib/color-palette"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockBackground: {
      setBlockBackground: (color: BackgroundColorKey) => ReturnType
    }
  }
}

// Every block node that should support the "Цвет → Фон" menu entry
export const BACKGROUND_SUPPORTED_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "callout",
  "toggle",
  "hiddenText",
  "resizableImage",
  "fileAttachment",
  "pageLink",
]

function isValidBg(value: unknown): value is BackgroundColorKey {
  return typeof value === "string" && (BACKGROUND_COLOR_KEYS as readonly string[]).includes(value)
}

export const BlockBackground = Extension.create({
  name: "blockBackground",

  addGlobalAttributes() {
    return [
      {
        types: BACKGROUND_SUPPORTED_TYPES,
        attributes: {
          backgroundColor: {
            default: null as BackgroundColorKey | null,
            parseHTML: (el) => {
              const raw = el.getAttribute("data-anynote-bg")
              return isValidBg(raw) ? raw : null
            },
            renderHTML: (attrs) => {
              const bg = attrs.backgroundColor as BackgroundColorKey | null
              if (!bg || bg === "default") return {}
              return {
                class: `anynote-bg-${bg}`,
                "data-anynote-bg": bg,
              }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setBlockBackground:
        (color) =>
        ({ state, dispatch, tr }) => {
          const { from, to } = state.selection
          let changed = false
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!BACKGROUND_SUPPORTED_TYPES.includes(node.type.name)) return
            const next = color === "default" ? null : color
            if (node.attrs.backgroundColor === next) return
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: next })
            changed = true
          })
          if (changed && dispatch) dispatch(tr)
          return changed
        },
    }
  },
})
