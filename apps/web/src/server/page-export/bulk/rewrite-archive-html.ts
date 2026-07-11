import { parseHTML } from 'linkedom'

import { extractFileId } from '@repo/page-export'
import { relativePath } from './naming'

const FILE_PATH_PREFIX = '/api/files/'
const PAGE_ID_RE = /\/pages\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function extractPageIdFromHref(href: string): string | null {
  if (!href.startsWith('/pages/') && !href.startsWith('/workspaces/')) return null
  return PAGE_ID_RE.exec(href)?.[1] ?? null
}

/**
 * Bulk-export variant of embed-images: instead of base64-inlining, bundled
 * images point at relative archive asset paths; links to exported pages become
 * relative file paths; everything else becomes absolute.
 */
export function rewriteHtmlForArchive(
  html: string,
  ctx: {
    fromDir: string
    baseUrl: string
    assetPathFor: (fileId: string) => string | null
    pagePathFor: (pageId: string) => string | null
  },
): { html: string; fileIds: string[] } {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`)
  const fileIds: string[] = []

  for (const el of Array.from(document.querySelectorAll('img'))) {
    const src = el.getAttribute('src') ?? ''
    const fileId = extractFileId(src)
    if (!fileId) continue
    const archivePath = ctx.assetPathFor(fileId)
    if (archivePath) {
      fileIds.push(fileId)
      el.setAttribute('src', relativePath(ctx.fromDir, archivePath))
    } else {
      el.setAttribute('src', `${ctx.baseUrl}${src}`)
    }
  }

  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? ''
    const pageId = extractPageIdFromHref(href)
    if (pageId) {
      const target = ctx.pagePathFor(pageId)
      a.setAttribute('href', target ? relativePath(ctx.fromDir, target) : `${ctx.baseUrl}${href}`)
      continue
    }
    if (href.startsWith(FILE_PATH_PREFIX)) {
      a.setAttribute('href', `${ctx.baseUrl}${href}`)
    }
  }

  for (const div of Array.from(document.querySelectorAll('[data-type="file-attachment"]'))) {
    const url = div.getAttribute('data-url') ?? ''
    if (url.startsWith(FILE_PATH_PREFIX)) {
      div.setAttribute('data-url', `${ctx.baseUrl}${url}`)
    }
  }

  return { html: document.body.innerHTML, fileIds }
}
