import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

export type BlockFlashMeta = { type: "set"; index: number } | { type: "clear" }

type BlockFlashState = { flashIndex: number | null }

export const blockFlashKey = new PluginKey<BlockFlashState>("blockIndexAttributes")

export const BlockIndexAttributes = Extension.create({
  name: "blockIndexAttributes",
  addProseMirrorPlugins() {
    return [
      new Plugin<BlockFlashState>({
        key: blockFlashKey,
        state: {
          init: () => ({ flashIndex: null }),
          apply(tr, value) {
            const meta = tr.getMeta(blockFlashKey) as BlockFlashMeta | undefined
            if (meta?.type === "set") return { flashIndex: meta.index }
            if (meta?.type === "clear") return { flashIndex: null }
            return value
          },
        },
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            const flashIndex = blockFlashKey.getState(state)?.flashIndex ?? null
            state.doc.content.forEach((node, offset, index) => {
              const attrs: Record<string, string> = { "data-block-index": String(index) }
              if (index === flashIndex) attrs.class = "block-flash"
              decos.push(Decoration.node(offset, offset + node.nodeSize, attrs))
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
