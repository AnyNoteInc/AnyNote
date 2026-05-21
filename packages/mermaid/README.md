# @repo/mermaid

Collaborative Mermaid diagram page for AnyNote. Split-pane: a bundled Monaco
editor (left) bound to a Yjs `Y.Text` named `mermaid` via `y-monaco`, and a live
diagram preview (right) rendered with `mermaid`, with zoom/pan and SVG/PNG export.

Loaded only via `next/dynamic` with `ssr: false` — Monaco and mermaid touch
`window`/`document` at module-eval time.
