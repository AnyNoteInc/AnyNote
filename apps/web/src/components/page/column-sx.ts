// Shared horizontal geometry for the page header and editor content so
// skeleton and real content line up pixel-for-pixel. `boxSizing: content-box`
// mirrors the ProseMirror rule in packages/editor/src/styles/content.css.
export const pageColumnSx = {
  maxWidth: "713px",
  width: "100%",
  mx: "auto",
  px: "48px",
  boxSizing: "content-box",
} as const
