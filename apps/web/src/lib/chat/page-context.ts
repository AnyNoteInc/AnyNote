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
  if (typeof v.content !== 'string') {
    return { error: 'pageContext.content must be a string' }
  }
  if (typeof v.isSelection !== 'boolean') {
    return { error: 'pageContext.isSelection must be a boolean' }
  }
  // An empty page is not an error — it is simply "no context": the binding
  // prompt still tells the agent which page the chat is about, and generation
  // must not fail just because the page has no text yet.
  if (v.content.trim().length === 0) return null
  return { content: v.content, isSelection: v.isSelection }
}

/** Page-binding block appended to the agent system prompt for PAGE chats: the
 *  agent otherwise has no way to know WHICH page «текущая страница» is, and
 *  «добавь суммаризацию в конец страницы» degrades into title-guessing.
 *  Server-built from DB ids — never client input. NOTE: the tool list mirrors
 *  the engines MCP page tools (page.tools.ts / page-file.tools.ts); update it
 *  when those tools are renamed or added. */
export function buildPageBindingPrompt(
  page: { id: string; title: string | null },
  workspaceId: string,
): string {
  const title = page.title?.trim() ? page.title : 'Без названия'
  return [
    `Этот чат привязан к странице «${title}» (workspaceId=${workspaceId}, pageId=${page.id}).`,
    'Когда пользователь говорит про «страницу», «текущую страницу» или «эту страницу», он имеет в виду именно её — используй эти идентификаторы в инструментах anynote:',
    '- appendToPage — добавить текст в конец страницы;',
    '- replaceInPage — точечно заменить текст на странице;',
    '- updatePage — полностью переписать содержимое (сначала прочитай getPageMarkdown);',
    '- renamePage — переименовать страницу;',
    '- attachFileToPage / uploadFileToPage — вставить файл в страницу;',
    '- getPageMarkdown — прочитать актуальное содержимое.',
    'Актуальный снимок страницы может приходить как вложение (attachment) — не запрашивай страницу повторно без необходимости.',
  ].join('\n')
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
