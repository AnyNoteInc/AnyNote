import type { ResolvedAttachment } from './file-content'

/** Hard cap on injected page/selection context (spec §6.3). */
export const MAX_PAGE_CONTEXT_CHARS = 200_000
export const PAGE_CONTEXT_ATTACHMENT_ID = 'page-context'
const TRUNCATION_MARKER = '\n\n…контент обрезан'

export type PageContextInput = {
  content: string
  isSelection: boolean
}

/** Validate the client-supplied pageContext. Returns null when absent,
 *  the parsed value, or `{error}` on malformed input. */
export function parsePageContext(raw: unknown): PageContextInput | null | { error: string } {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'pageContext must be an object' }
  }
  const v = raw as Record<string, unknown>
  if (typeof v.content !== 'string' || v.content.trim().length === 0) {
    return { error: 'pageContext.content must be a non-empty string' }
  }
  if (typeof v.isSelection !== 'boolean') {
    return { error: 'pageContext.isSelection must be a boolean' }
  }
  return { content: v.content, isSelection: v.isSelection }
}

/** Page/selection context → synthetic attachment riding the proven attachments
 *  channel (the agents `_attachments.j2` prompt-injection guard wraps it). */
export function buildPageContextAttachment(
  ctx: PageContextInput,
  pageTitle: string,
): ResolvedAttachment {
  let content = ctx.content
  if (content.length > MAX_PAGE_CONTEXT_CHARS) {
    let sliced = content.slice(0, MAX_PAGE_CONTEXT_CHARS)
    // Never split a surrogate pair: drop a trailing lone high surrogate so the
    // truncated text stays well-formed UTF-16 (a lone half would serialize as
    // U+FFFD and can break strict JSON consumers downstream).
    const lastCode = sliced.charCodeAt(sliced.length - 1)
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) sliced = sliced.slice(0, -1)
    content = sliced + TRUNCATION_MARKER
  }
  const name = ctx.isSelection ? 'Выделенный фрагмент.md' : `${pageTitle.trim() || 'Страница'}.md`
  return {
    id: PAGE_CONTEXT_ATTACHMENT_ID,
    name,
    mime: 'text/markdown',
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    included: true,
    content,
  }
}
