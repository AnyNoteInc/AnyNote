// Shared horizontal geometry for the page header and editor content so
// skeleton and real content line up pixel-for-pixel. Total width is capped
// at 857px (= 713 reading column + 144px side padding) using border-box so
// the inner content area is 713px — matching the ProseMirror `max-width:
// 713px` content-box rule in packages/editor/src/styles/content.css. The
// 72px side padding reserves the gutter for the block controls (Plus +
// drag handle) so they never clip against the overflow-x:hidden scroller.
// In full-width mode the `page-column` class drops the max-width via
// [data-full-width="true"] in content.css; border-box keeps width: 100%
// from overflowing by the padding amount (144px).
export const pageColumnSx = {
  maxWidth: '857px',
  width: '100%',
  mx: 'auto',
  // xs: контролы не показываются на тач-экранах — компактный гаттер,
  // синхронизирован с @media в content.css.
  px: { xs: '24px', sm: '72px' },
  boxSizing: 'border-box',
} as const

export const PAGE_COLUMN_CLASS = 'page-column'
