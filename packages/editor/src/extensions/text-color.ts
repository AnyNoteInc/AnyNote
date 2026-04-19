import { Mark, mergeAttributes } from "@tiptap/core"

import type { TextColorKey } from "../lib/color-palette"
import { TEXT_COLOR_KEYS } from "../lib/color-palette"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    anynoteTextColor: {
      setAnynoteTextColor: (color: TextColorKey) => ReturnType
      unsetAnynoteTextColor: () => ReturnType
    }
  }
}

function isValidColor(value: unknown): value is TextColorKey {
  return typeof value === "string" && (TEXT_COLOR_KEYS as readonly string[]).includes(value)
}

export const AnynoteTextColor = Mark.create({
  name: "anynoteTextColor",

  addAttributes() {
    return {
      color: {
        default: "default" as TextColorKey,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-anynote-color")
          return isValidColor(raw) ? raw : "default"
        },
        renderHTML: (attrs) => {
          const color = attrs.color as TextColorKey
          if (!color || color === "default") return {}
          return {
            class: `anynote-color-${color}`,
            "data-anynote-color": color,
          }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-anynote-color]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setAnynoteTextColor:
        (color) =>
        ({ chain }) => {
          if (color === "default") {
            return chain().unsetMark(this.name).run()
          }
          return chain().setMark(this.name, { color }).run()
        },
      unsetAnynoteTextColor:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    }
  },
})
