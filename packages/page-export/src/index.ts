// Editor-independent page-export building blocks, shared by apps/web (the
// export route + PDF_ZIP job) and apps/engines (the exportPageToPdf MCP tool).
// The rich Tiptap→HTML render stays per-consumer: apps/web keeps the full
// @repo/editor server-extension set (Bundler resolution — not loadable from
// the engines Node runtime); engines renders with its own schema + sanitizer.
//
// NodeNext-clean like @repo/domain: explicit .ts import extensions, erasable
// syntax only — the engines runtime loads these files via Node type stripping.

export {
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
} from './errors.ts'
export { htmlToPdf } from './html-to-pdf.ts'
export { officeToPdf } from './office-to-pdf.ts'
export { embedImagesAndRewriteLinks, extractFileId } from './embed-images.ts'
export { wrapHtmlDocument } from './wrap-html-document.ts'
export { PRINT_STYLESHEET } from './print-stylesheet.ts'
