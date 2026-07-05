// Re-export shim: implementation moved to @repo/editor so client code (block
// "Копировать текст") shares one converter. Kept so existing
// `@/server/page-export` consumers and the pinned export test stay stable.
export { htmlToMarkdown } from '@repo/editor/lib/html-to-markdown'
