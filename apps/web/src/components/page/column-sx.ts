// Shared horizontal geometry for the page header and editor content so
// skeleton and real content line up pixel-for-pixel. Total width is capped
// at 809px (= 713 reading column + 96px side padding) using border-box so
// the inner content area is 713px — matching the ProseMirror `max-width:
// 713px` content-box rule in packages/editor/src/styles/content.css.
// In full-width mode the `page-column` class drops the max-width via
// [data-full-width="true"] in content.css; border-box keeps width: 100%
// from overflowing by the padding amount (96px).
export const pageColumnSx = {
  maxWidth: '809px',
  width: '100%',
  mx: 'auto',
  px: '48px',
  boxSizing: 'border-box',
} as const

export const PAGE_COLUMN_CLASS = 'page-column'
