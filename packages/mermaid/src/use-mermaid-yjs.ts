'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

export type MermaidYjsResources = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  ytext: Y.Text
}

/**
 * Create the Y.Doc + HocuspocusProvider inside useEffect (not useState init) so
 * React StrictMode's mount→unmount→remount doesn't leave destroyed resources in
 * state. The mermaid source is a single Y.Text root named 'mermaid'.
 */
export function useMermaidYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
}): MermaidYjsResources | null {
  const { pageId, yjsUrl, yjsToken, initialContentYjs } = args
  const [resources, setResources] = useState<MermaidYjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    if (initialContentYjs) {
      const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
      Y.applyUpdate(ydoc, bytes)
    }
    const ytext = ydoc.getText('mermaid')
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
  }, [pageId, yjsUrl, yjsToken, initialContentYjs])

  return resources
}
