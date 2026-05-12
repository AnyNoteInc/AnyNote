import { Plugin, PluginKey } from '@tiptap/pm/state'

import { ColumnLayoutSchema, ColumnSchema } from './column-layout.schema'
import { dissolveColumnLayouts } from './column-layout.dissolve'

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
})
