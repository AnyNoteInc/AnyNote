import { Plugin, PluginKey } from '@tiptap/pm/state'

import { ColumnLayoutSchema } from './column-layout.schema'
import { dissolveColumnLayouts } from './column-layout.dissolve'
import { columnResizePlugin } from './column-resize'

export { ColumnSchema as Column } from './column-layout.schema'

const dissolveKey = new PluginKey('columnLayoutDissolve')

export const ColumnLayout = ColumnLayoutSchema.extend({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dissolveKey,
        appendTransaction(_transactions, _oldState, newState) {
          return dissolveColumnLayouts(newState) ?? undefined
        },
      }),
      columnResizePlugin,
    ]
  },
})
