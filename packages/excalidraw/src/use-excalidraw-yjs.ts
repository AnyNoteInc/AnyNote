"use client"

import { useEffect, useState } from "react"
import * as Y from "yjs"
import { HocuspocusProvider } from "@hocuspocus/provider"

/**
 * Owns the Y.Doc and HocuspocusProvider for the board.
 *
 * We deliberately DO NOT construct the `ExcalidrawBinding` here: the
 * `@timephy/y-excalidraw` constructor requires the live
 * `ExcalidrawImperativeAPI`, which only becomes available after Excalidraw
 * mounts and invokes its `excalidrawAPI` callback. The binding is therefore
 * created lazily in the component (see `board-inner.tsx`) once the API is
 * known; this hook only returns the Yjs primitives it will need.
 *
 * `useState(initializer)` is used for both the doc and the provider so that
 * the references stay stable across re-renders. Teardown happens in the
 * cleanup effect so `StrictMode`'s double-invoke behaves.
 */
export function useExcalidrawYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
}) {
  const { pageId, yjsUrl, yjsToken } = args

  const ydoc = useState<Y.Doc>(() => new Y.Doc())[0]

  // Yjs containers shared with the Excalidraw binding.
  // Names match @timephy/y-excalidraw conventions.
  const yElements = useState<Y.Array<Y.Map<unknown>>>(
    () => ydoc.getArray<Y.Map<unknown>>("elements"),
  )[0]
  const yAssets = useState<Y.Map<unknown>>(() => ydoc.getMap<unknown>("assets"))[0]

  const provider = useState<HocuspocusProvider>(
    () =>
      new HocuspocusProvider({
        url: yjsUrl,
        name: pageId,
        document: ydoc,
        token: yjsToken,
      }),
  )[0]

  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
    // ydoc / provider are stable by construction; we only want a true
    // unmount-time cleanup, hence the empty dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ydoc, provider, yElements, yAssets }
}
