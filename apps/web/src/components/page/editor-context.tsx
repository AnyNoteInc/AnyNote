'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Editor } from '@repo/editor'

type Ctx = {
  getEditor: () => Editor | null
  setEditor: (editor: Editor | null) => void
  hasEditor: boolean
  /** The live instance — effects that subscribe to editor events must depend
   *  on THIS (not the stable getEditor) so an in-place editor swap (Tiptap
   *  recreated for the same page, e.g. after a router.refresh changes the
   *  ydoc/provider deps) re-binds them instead of listening to a destroyed
   *  instance. */
  editor: Editor | null
}

const PageEditorContext = createContext<Ctx | null>(null)

export function PageEditorProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Editor | null>(null)
  const [instance, setInstance] = useState<Editor | null>(null)

  const getEditor = useCallback(() => ref.current, [])
  const setEditor = useCallback((editor: Editor | null) => {
    ref.current = editor
    setInstance(editor)
  }, [])

  // Memoized so a parent re-render (e.g. the workspace layout) doesn't
  // invalidate the context and drag every consumer — PageRenderer hosts the
  // whole Tiptap editor — along with it. Identity changes only on actual
  // editor mount/unmount/recreate.
  const value = useMemo<Ctx>(
    () => ({ getEditor, setEditor, hasEditor: instance !== null, editor: instance }),
    [getEditor, setEditor, instance],
  )

  return <PageEditorContext.Provider value={value}>{children}</PageEditorContext.Provider>
}

export function usePageEditor(): Ctx {
  const ctx = useContext(PageEditorContext)
  if (!ctx) {
    return {
      getEditor: () => null,
      setEditor: () => undefined,
      hasEditor: false,
      editor: null,
    }
  }
  return ctx
}
