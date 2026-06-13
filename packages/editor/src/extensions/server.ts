// Schema-only Tiptap extensions for server-side rendering (e.g. PDF/HTML export).
// No React, no MUI, no Yjs, no node views — only parseHTML / renderHTML / addAttributes.
//
// The .tsx siblings re-extend these with addNodeView for client use.

export { AudioSchema as Audio } from './audio.schema'
export { BookmarkSchema as Bookmark } from './bookmark.schema'
export { CalloutSchema as Callout } from './callout.schema'
export { DrawioSchema as Drawio } from './drawio.schema'
export { EmbedSchema as Embed } from './embed.schema'
export { EmbeddedDatabaseSchema as EmbeddedDatabase } from './embedded-database.schema'
export { FileAttachmentSchema as FileAttachment } from './file-attachment.schema'
export { VideoSchema as Video } from './video.schema'
export { HiddenTextSchema as HiddenText } from './hidden-text.schema'
export { PageLinkSchema as PageLink } from './page-link.schema'

export { ReminderSchema as Reminder } from './reminder.schema'
export { DateSchema as DateNode } from './date.schema'

export { ColumnLayoutSchema as ColumnLayout, ColumnSchema as Column } from './column-layout.schema'

export { TabsSchema as Tabs, TabSchema as Tab } from './tabs.schema'

// Pure string/config helpers (no React) shared with the client editors.
export { LINK_HTML_ATTRIBUTES, normalizeLinkHref } from '../link-href'

// These two have no React imports — re-export as-is.
export { AnynoteTextColor } from './text-color'
export { BlockBackground, BACKGROUND_SUPPORTED_TYPES } from './block-background'
export { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
export { default as Code } from '@tiptap/extension-code'
export { default as Highlight } from '@tiptap/extension-highlight'
export { default as Mention } from '@tiptap/extension-mention'
export { default as Underline } from '@tiptap/extension-underline'
export { TextStyleKit } from '@tiptap/extension-text-style'
