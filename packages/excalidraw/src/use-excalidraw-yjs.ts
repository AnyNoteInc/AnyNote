'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

export type YjsResources = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  yElements: Y.Array<Y.Map<unknown>>
  yAssets: Y.Map<unknown>
}

// Creates Y.Doc + HocuspocusProvider inside useEffect so they're torn down
// and recreated per mount cycle. This matters in React StrictMode dev mode,
// which mounts → unmounts → remounts; a `useState(initializer)` pattern
// would survive the teardown but leave destroyed resources in state.
export function useExcalidrawYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
}): YjsResources | null {
  const { pageId, yjsUrl, yjsToken, initialContentYjs } = args
  const [resources, setResources] = useState<YjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    if (initialContentYjs) {
      const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
      Y.applyUpdate(ydoc, bytes)
    }
    const yElements = ydoc.getArray<Y.Map<unknown>>('elements')
    const yAssets = ydoc.getMap<unknown>('assets')
    const provider = new HocuspocusProvider({
      url: yjsUrl,
      name: pageId,
      document: ydoc,
      token: yjsToken,
    })
    setResources({ ydoc, provider, yElements, yAssets })
    return () => {
      setResources(null)
      // Defer destroy so an in-flight WebSocket handshake can complete
      // before we close the socket. Prevents the browser warning
      // "WebSocket is closed before the connection is established" during
      // React StrictMode dev remounts.
      setTimeout(() => {
        provider.destroy()
        ydoc.destroy()
      }, 300)
    }
  }, [pageId, yjsUrl, yjsToken, initialContentYjs])

  return resources
}
