"use client"

import { createContext, useContext, useRef, useState, type ReactNode } from "react"
import type { Editor } from "@repo/editor"

type Ctx = {
  getEditor: () => Editor | null
  setEditor: (editor: Editor | null) => void
  hasEditor: boolean
}

const PageEditorContext = createContext<Ctx | null>(null)

export function PageEditorProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Editor | null>(null)
  const [hasEditor, setHasEditor] = useState(false)

  const value: Ctx = {
    getEditor: () => ref.current,
    setEditor: (editor) => {
      ref.current = editor
      setHasEditor(Boolean(editor))
    },
    hasEditor,
  }

  return <PageEditorContext.Provider value={value}>{children}</PageEditorContext.Provider>
}

export function usePageEditor(): Ctx {
  const ctx = useContext(PageEditorContext)
  if (!ctx) {
    return {
      getEditor: () => null,
      setEditor: () => undefined,
      hasEditor: false,
    }
  }
  return ctx
}
