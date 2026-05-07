// Schema-only Tiptap extensions for server-side rendering (e.g. PDF/HTML export).
// No React, no MUI, no Yjs, no node views — only parseHTML / renderHTML / addAttributes.
//
// The .tsx siblings re-extend these with addNodeView for client use.

export { CalloutSchema as Callout } from './callout.schema'
export { ToggleSchema as Toggle } from './toggle.schema'
export { FileAttachmentSchema as FileAttachment } from './file-attachment.schema'
export { HiddenTextSchema as HiddenText } from './hidden-text.schema'
export { PageLinkSchema as PageLink } from './page-link.schema'

// These two have no React imports — re-export as-is.
export { AnynoteTextColor } from './text-color'
export { BlockBackground, BACKGROUND_SUPPORTED_TYPES } from './block-background'
