import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import type { HocuspocusProvider } from "@hocuspocus/provider"
import type * as Y from "yjs"

import type { AnyNoteEditorUser } from "../types.js"

export const buildCollaboration = (args: {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: AnyNoteEditorUser
}) => [
  Collaboration.configure({ document: args.ydoc, field: "default" }),
  CollaborationCaret.configure({
    provider: args.provider,
    user: { name: args.user.name, color: args.user.color },
  }),
]
