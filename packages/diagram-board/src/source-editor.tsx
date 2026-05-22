'use client'

import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'
import type * as monaco from 'monaco-editor'

import { configureMonaco } from './monaco-env'
import { monacoThemeForMode } from './theme'
import type { ColorMode } from './render-types'

configureMonaco()

type Props = {
  ytext: Y.Text
  provider: HocuspocusProvider
  mode: ColorMode
  editable: boolean
  languageId: string
  registerLanguage: (m: typeof monaco) => void
  placeholder?: string
}

export function DiagramSourceEditor({
  ytext,
  provider,
  mode,
  editable,
  languageId,
  registerLanguage,
  placeholder,
}: Props) {
  const bindingRef = useRef<MonacoBinding | null>(null)

  const handleMount: OnMount = (editorInstance, monaco) => {
    registerLanguage(monaco)
    const model = editorInstance.getModel()
    if (!model) return
    monaco.editor.setModelLanguage(model, languageId)
    bindingRef.current = new MonacoBinding(
      ytext,
      model,
      new Set([editorInstance]),
      provider.awareness ?? null,
    )
  }

  useEffect(() => {
    return () => {
      bindingRef.current?.destroy()
      bindingRef.current = null
    }
  }, [])

  return (
    <Editor
      height="100%"
      defaultLanguage={languageId}
      theme={monacoThemeForMode(mode)}
      onMount={handleMount}
      options={{
        readOnly: !editable,
        minimap: { enabled: false },
        fontSize: 13,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        lineNumbersMinChars: 3,
        placeholder,
      }}
    />
  )
}
