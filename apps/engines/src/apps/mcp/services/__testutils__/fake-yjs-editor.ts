import type { YjsPageEditor } from '../yjs-page-editor.service.js'

/** Constructor stub for PageWriter specs that never reach the live-doc path:
 *  always reports `applied:false`, i.e. the direct-DB fallback behavior. */
export function makeFakeYjsEditor(): YjsPageEditor {
  return {
    applyContentEdit: async () => ({ applied: false as const }),
  } as unknown as YjsPageEditor
}
