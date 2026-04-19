import type { Editor } from "@tiptap/core"
import { HocuspocusProvider } from "@hocuspocus/provider"
import { prosemirrorJSONToYDoc } from "y-prosemirror"
import * as Y from "yjs"

type MoveBlockParams = {
  editor: Editor
  sourcePos: number
  targetPageId: string
  yjsUrl: string
  token: string
  fragmentField?: string
}

export type MoveBlockResult = { ok: true } | { ok: false; error: string }

const FLUSH_DELAY_MS = 200

// Moves the block at sourcePos (in editor's local ProseMirror doc) to the end
// of the target page's ProseMirror document, over Hocuspocus/Yjs.
//
// Flow:
//   1. Serialize the node to ProseMirror JSON.
//   2. Open a fresh Y.Doc + HocuspocusProvider for the target page.
//   3. Wait for initial sync so we don't overwrite anything.
//   4. Materialize a temporary Y.Doc from { type: "doc", content: [json] } using
//      prosemirrorJSONToYDoc — this converts the JSON into the correct Y.Xml
//      structure end-to-end.
//   5. Clone the top-level children (our moved block) into the real target Y.Doc.
//   6. Remove the block from the source editor (local edit syncs out via its
//      own provider).
//   7. Disconnect the background provider.
// Must match the `field` passed to `Collaboration.configure` on the editor.
// y-prosemirror and HocuspocusProvider both default to "prosemirror", but our
// editor is configured with "default", so that's what both the source editor
// binding and any write-through to a target page's Y.Doc have to share.
export async function moveBlockToPage({
  editor,
  sourcePos,
  targetPageId,
  yjsUrl,
  token,
  fragmentField = "default",
}: MoveBlockParams): Promise<MoveBlockResult> {
  const node = editor.state.doc.nodeAt(sourcePos)
  if (!node) return { ok: false, error: "Block not found at source position" }
  const json = node.toJSON()
  const nodeSize = node.nodeSize

  const yDoc = new Y.Doc()
  const provider = new HocuspocusProvider({
    url: yjsUrl,
    name: targetPageId,
    document: yDoc,
    token,
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Sync timeout")), 10_000)
      provider.on("synced", () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    const syntheticDoc = { type: "doc", content: [json] }
    const tempYDoc = prosemirrorJSONToYDoc(editor.schema, syntheticDoc, fragmentField)
    const tempFragment = tempYDoc.getXmlFragment(fragmentField)

    const targetFragment = yDoc.getXmlFragment(fragmentField)
    yDoc.transact(() => {
      for (const child of tempFragment.toArray()) {
        if (child instanceof Y.XmlElement) {
          targetFragment.push([child.clone()])
        } else if (child instanceof Y.XmlText) {
          targetFragment.push([child.clone()])
        }
      }
    })

    tempYDoc.destroy()

    // Give Hocuspocus a window to broadcast our transact() update to the
    // server before we tear down the provider below. Without this, fast paths
    // can destroy the socket before the update frame ships, and the insert is
    // lost server-side.
    await new Promise<void>((resolve) => setTimeout(resolve, FLUSH_DELAY_MS))

    editor
      .chain()
      .focus()
      .deleteRange({ from: sourcePos, to: sourcePos + nodeSize })
      .run()

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    provider.destroy()
    yDoc.destroy()
  }
}
