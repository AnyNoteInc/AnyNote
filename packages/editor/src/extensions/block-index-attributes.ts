import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

export const BlockIndexAttributes = Extension.create({
  name: "blockIndexAttributes",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockIndexAttributes"),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.content.forEach((node, offset, index) => {
              decos.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  "data-block-index": String(index),
                }),
              )
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
