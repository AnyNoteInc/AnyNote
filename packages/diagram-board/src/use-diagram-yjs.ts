'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

export type DiagramYjsResources = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  ytext: Y.Text
}

/**
 * Create the Y.Doc + HocuspocusProvider inside useEffect (not useState init) so
 * React StrictMode's mount→unmount→remount doesn't leave destroyed resources in
 * state. The diagram source is a single Y.Text root named `docName`.
 */
export function useDiagramYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
  docName: string
}): DiagramYjsResources | null {
  const { pageId, yjsUrl, yjsToken, initialContentYjs, docName } = args
  const [resources, setResources] = useState<DiagramYjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    if (initialContentYjs) {
      const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
      Y.applyUpdate(ydoc, bytes)
    }
    const ytext = ydoc.getText(docName)
    const provider = new HocuspocusProvider({ url: yjsUrl, name: pageId, document: ydoc, token: yjsToken })
    setResources({ ydoc, provider, ytext })
    return () => {
      setResources(null)
      // Defer destroy so an in-flight WebSocket handshake can complete.
      setTimeout(() => {
        provider.destroy()
        ydoc.destroy()
      }, 300)
    }
  }, [pageId, yjsUrl, yjsToken, initialContentYjs, docName])

  return resources
}
