# @repo/excalidraw

Excalidraw canvas with Yjs-backed real-time collaboration via
`@timephy/y-excalidraw` and `@hocuspocus/provider`.

## Public API

```tsx
import { Board } from "@repo/excalidraw"

<Board
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
