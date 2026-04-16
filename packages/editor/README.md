# @repo/editor

Tiptap-based collaborative rich-text editor for AnyNote.

## Exports

- `AnyNoteEditor` — the main React client component. Connects to the Yjs server via `HocuspocusProvider` and renders a Tiptap editor with collaborative cursors, slash menu, drag handle, floating toolbar, markdown shortcuts, and file upload.
- `EditorThemeBridge` — translates MUI palette tokens into CSS variables consumed by the editor content stylesheet. Mount once per app under `ThemeProvider`.
- `defaultSlashItems` — default slash-command registry (headings, lists, quote, code block, divider, table).
- Public types: `AnyNoteEditorProps`, `AnyNoteEditorUser`, `UploadHandler`, `UploadedFile`, `SlashCommandItem`.
- Styles: `@repo/editor/styles` — import in a client entry to apply base content styles and collaborative caret styling.

## Usage

```tsx
import dynamic from "next/dynamic"

const AnyNoteEditor = dynamic(() => import("@repo/editor").then((m) => m.AnyNoteEditor), {
  ssr: false,
})
```

Use inside a MUI `ThemeProvider` and ensure `<EditorThemeBridge />` is mounted once.

## Runtime requirements

- A Hocuspocus server reachable over WebSocket (see `apps/yjs`).
- A JWT issuer that produces tokens accepted by that server.
- An upload handler that persists files and returns `{ id, src }`.
