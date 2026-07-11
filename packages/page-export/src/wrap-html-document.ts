import { PRINT_STYLESHEET } from './print-stylesheet.ts'

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function wrapHtmlDocument(opts: {
  bodyHtml: string
  title: string
  icon: string | null
}): string {
  const titleEsc = escapeHtml(opts.title)
  const iconEsc = opts.icon ? escapeHtml(opts.icon) : ''
  const heading = iconEsc ? `${iconEsc} ${titleEsc}` : titleEsc

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${titleEsc}</title>
<style>${PRINT_STYLESHEET}</style>
</head>
<body>
<h1 class="document-title">${heading}</h1>
${opts.bodyHtml}
</body>
</html>`
}
