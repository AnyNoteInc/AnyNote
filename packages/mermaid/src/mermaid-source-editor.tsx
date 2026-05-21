'use client'

import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'

import { configureMonaco } from './monaco-env'
import { MERMAID_LANGUAGE_ID, registerMermaidLanguage } from './mermaid-language'
import { monacoThemeForMode, type ColorMode } from './mermaid-theme'

configureMonaco()

type Props = {
  ytext: Y.Text
  provider: HocuspocusProvider
  mode: ColorMode
  editable: boolean
}

export function MermaidSourceEditor({ ytext, provider, mode, editable }: Props) {
  const bindingRef = useRef<MonacoBinding | null>(null)

  const handleMount: OnMount = (editorInstance, monaco) => {
    registerMermaidLanguage(monaco)
    const model = editorInstance.getModel()
    if (!model) return
    monaco.editor.setModelLanguage(model, MERMAID_LANGUAGE_ID)
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
      defaultLanguage={MERMAID_LANGUAGE_ID}
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
        placeholder: 'graph TD;\n  A --> B;',
      }}
    />
  )
}
