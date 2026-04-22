"use client"

import { useEffect, useState } from "react"
import * as Y from "yjs"
import { HocuspocusProvider } from "@hocuspocus/provider"

export interface GenogramYjsResources {
  ydoc: Y.Doc
  provider: HocuspocusProvider
}

export interface UseGenogramYjsArgs {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
}

/**
 * Creates Y.Doc + HocuspocusProvider inside useEffect so they're torn down
 * and recreated per mount cycle. Destroy is deferred 300ms to let the
 * WebSocket handshake settle during React StrictMode dev remounts — same
 * reasoning as useExcalidrawYjs in @repo/excalidraw.
 */
export function useGenogramYjs(args: UseGenogramYjsArgs): GenogramYjsResources | null {
  const { pageId, yjsUrl, yjsToken } = args
  const [resources, setResources] = useState<GenogramYjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({
      url: yjsUrl,
      name: pageId,
      document: ydoc,
      token: yjsToken,
    })
    setResources({ ydoc, provider })
    return () => {
      setResources(null)
      setTimeout(() => {
        provider.destroy()
        ydoc.destroy()
      }, 300)
    }
  }, [pageId, yjsUrl, yjsToken])

  return resources
}
