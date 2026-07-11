import type { YjsPageEditor } from '../yjs-page-editor.service.js'

/** Constructor stub for PageWriter/PageTools specs that never reach the
 *  live-doc path: edits report `applied:false` and reads report `null`, i.e.
 *  the direct-DB fallback behavior. */
export function makeFakeYjsEditor(): YjsPageEditor {
  return {
    applyContentEdit: async () => ({ applied: false as const }),
    readLiveContent: async () => null,
  } as unknown as YjsPageEditor
}
