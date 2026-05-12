import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { ColumnLayoutSchema, ColumnSchema } from './column-layout.schema'
import { dissolveColumnLayouts } from './column-layout.dissolve'
import { ColumnLayoutNodeView } from '../components/column-layout-node-view'

const dissolveKey = new PluginKey('columnLayoutDissolve')

export const Column = ColumnSchema

export const ColumnLayout = ColumnLayoutSchema.extend({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dissolveKey,
        appendTransaction(_transactions, _oldState, newState) {
          return dissolveColumnLayouts(newState) ?? undefined
        },
      }),
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ColumnLayoutNodeView)
  },
})
