import { Extension } from "@tiptap/core"
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion"

import type { SlashCommandItem } from "../types.js"

export type SlashMenuRender = {
  onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => void
  onUpdate: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => void
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
  onExit: () => void
}

export type SlashMenuOptions = {
  items: (query: string) => SlashCommandItem[]
  render: () => SlashMenuRender
}

export const SlashMenu = Extension.create<SlashMenuOptions>({
  name: "slashMenu",
  addOptions() {
    return {
      items: () => [],
      render: () => ({
        onStart: () => {},
        onUpdate: () => {},
        onKeyDown: () => false,
        onExit: () => {},
      }),
    }
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        items: ({ query }) => this.options.items(query),
        command: ({ editor, range, props }) => {
          props.run({ editor, range })
        },
        render: this.options.render,
      }),
    ]
  },
})
