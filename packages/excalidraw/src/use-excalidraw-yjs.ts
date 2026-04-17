"use client"

import { useEffect, useState } from "react"
import * as Y from "yjs"
import { HocuspocusProvider } from "@hocuspocus/provider"

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
}): YjsResources | null {
  const { pageId, yjsUrl, yjsToken } = args
  const [resources, setResources] = useState<YjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    const yElements = ydoc.getArray<Y.Map<unknown>>("elements")
    const yAssets = ydoc.getMap<unknown>("assets")
    const provider = new HocuspocusProvider({
      url: yjsUrl,
      name: pageId,
      document: ydoc,
      token: yjsToken,
    })
    setResources({ ydoc, provider, yElements, yAssets })
    return () => {
      provider.destroy()
      ydoc.destroy()
      setResources(null)
    }
  }, [pageId, yjsUrl, yjsToken])

  return resources
}
