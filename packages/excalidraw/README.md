# @repo/excalidraw

Excalidraw canvas with Yjs-backed real-time collaboration via
`@timephy/y-excalidraw` and `@hocuspocus/provider`.

## Public API

```tsx
import { Board } from "@repo/excalidraw"

;<Board
  pageId="..."
  workspaceId="..."
  yjsUrl="ws://localhost:1234"
  yjsToken={async () => "..."}
  uploadHandler={async ({ blob, filename }) => ({ id, src })}
  editable
/>
```

## Notes

- Renders only on the client: `Board` internally uses `next/dynamic` with
  `ssr: false` to load its implementation, but consumers should still gate
  the import behind their own `dynamic(() => import("@repo/excalidraw"), { ssr: false })`
  if they use it inside a Server Component tree.
- Uses `useState(initializer)` for `Y.Doc` and `HocuspocusProvider` so both
  remain stable across re-renders. The `ExcalidrawBinding` from
  `@timephy/y-excalidraw` requires the imperative API, so it is created
  lazily inside `onMount` and torn down in a cleanup effect.
- File uploads go through the consumer-provided `UploadHandler`. The
  package does not attach files to pages directly — the consumer wires
  attach-to-page inside the closure returned from `createUploadHandler`
  (see `apps/web`).

## Known limitations

Image assets dropped onto the canvas are currently stored both in S3
(via the `uploadHandler`) AND encoded as dataURLs inside `Page.contentYjs`
by `@timephy/y-excalidraw`. This means the bytea column grows with every
pasted image.

The design spec prescribes a different flow: store only an S3 reference in
`yAssets` and populate Excalidraw's file cache on load via
`excalidrawAPI.addFiles(...)`. Implementing that requires a binding fork
or a PR upstream to `@timephy/y-excalidraw` so it persists a file-id
placeholder instead of the dataURL. Deferred.

Upload-side plumbing (`FilesHandler`, `file.attachToPage`) is in place so
the existing page-files record survives the eventual swap.
