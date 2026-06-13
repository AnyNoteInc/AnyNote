'use client'

import { Box } from '@mui/material'
import { HocuspocusProvider } from '@hocuspocus/provider'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskList from '@tiptap/extension-task-list'
import Typography from '@tiptap/extension-typography'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import * as Y from 'yjs'

import { buildCollaboration } from './extensions/collaboration'
import { buildPlaceholder } from './extensions/placeholder'
import { Callout } from './extensions/callout'
import { TaskItemWithCheckbox } from './extensions/task-item-view'
import { LINK_HTML_ATTRIBUTES } from './link-href'
import type { AnyNoteEditorUser } from './types'

export type SyncedBlockNestedEditorProps = {
  /** The SyncedBlock id — the nested doc name is `syncedBlock:{blockId}`. */
  readonly blockId: string
  readonly yjsUrl: string
  /** Mints a fresh user JWT — the SAME generic /api/yjs/token; the yjs server
   *  gates access via `canAccessSyncedBlock` on the `syncedBlock:` document name,
   *  so the token is NOT page/block-bound. */
  readonly yjsToken: () => Promise<string>
  readonly user: AnyNoteEditorUser
  readonly editable: boolean
}

type YjsResources = { ydoc: Y.Doc; provider: HocuspocusProvider }

/**
 * The LIVE nested collaborative editor mounted inside a `syncedBlock` node view.
 * It opens a SECOND HocuspocusProvider to the `syncedBlock:{blockId}` document —
 * the proven block-move.ts cross-doc-provider precedent — so edits propagate in
 * real time to EVERY instance of the synced block across all host pages.
 *
 * Infinite-nesting guard: the extension set here deliberately OMITS the
 * `syncedBlock` node itself (a synced block can never contain another synced
 * block — spec §10 non-goal), so the schema simply rejects a nested instance.
 *
 * Connection cleanup mirrors the page editor: the provider/ydoc are created in a
 * useEffect and torn down on unmount (deferred so an in-flight handshake can
 * settle — the React-StrictMode dev-remount + 9B isDestroyed lesson).
 */
export function SyncedBlockNestedEditor(props: SyncedBlockNestedEditorProps) {
  const { blockId, yjsUrl, yjsToken } = props
  const [resources, setResources] = useState<YjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({
      url: yjsUrl,
      name: `syncedBlock:${blockId}`,
      document: ydoc,
      token: yjsToken,
    })
    setResources({ ydoc, provider })
    return () => {
      setResources(null)
      setTimeout(() => {
        provider.destroy()
        ydoc.destroy()
      }, 300)
    }
  }, [blockId, yjsUrl, yjsToken])

  if (!resources) {
    return <Box className="anynote-synced-block-editor" sx={{ minHeight: 32 }} />
  }
  return <NestedInner {...props} resources={resources} />
}

function NestedInner(props: SyncedBlockNestedEditorProps & { resources: YjsResources }) {
  const { user, editable, resources } = props
  const { ydoc, provider } = resources

  const editor = useEditor(
    {
      editable,
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          dropcursor: false,
          link: false,
          underline: false,
        }),
        buildPlaceholder('Синхронизированный блок…'),
        Link.configure({
          openOnClick: false,
          enableClickSelection: true,
          HTMLAttributes: LINK_HTML_ATTRIBUTES,
        }),
        Highlight.configure({ multicolor: true }),
        Underline,
        Typography,
        TaskList,
        TaskItemWithCheckbox.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Callout,
        // NOTE: the `syncedBlock` node is intentionally NOT registered here —
        // a synced block must never nest inside a synced block (spec §10).
        ...buildCollaboration({ ydoc, provider, user }),
      ],
    },
    [ydoc, provider],
  )

  return (
    <Box className="anynote-synced-block-editor" sx={{ px: 1, py: 0.5 }}>
      <EditorContent editor={editor} />
    </Box>
  )
}
