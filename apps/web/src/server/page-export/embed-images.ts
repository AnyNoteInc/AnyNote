import { parseHTML } from 'linkedom'

import type { PrismaClient } from '@repo/db'
import type { StorageClient } from '@repo/storage'

const FILE_PATH_PREFIX = '/api/files/'
const PAGE_PATH_PREFIX = '/workspaces/'
const NEUTRAL_PAGE_PATH_PREFIX = '/pages/'
const CONCURRENCY = 8

type Ctx = {
  storage: Pick<StorageClient, 'get'>
  prisma: Pick<PrismaClient, 'file'>
  baseUrl: string
}

function extractFileId(src: string): string | null {
  if (!src.startsWith(FILE_PATH_PREFIX)) return null
  const tail = src.slice(FILE_PATH_PREFIX.length)
  const slash = tail.indexOf('/')
  const q = tail.indexOf('?')
  let end = tail.length
  if (slash >= 0) end = Math.min(end, slash)
  if (q >= 0) end = Math.min(end, q)
  return tail.slice(0, end) || null
}

async function streamToBase64(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('base64')
}

async function withLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      const item = items[i]!
      results[i] = await worker(item)
    }
  })
  await Promise.all(runners)
  return results
}

export async function embedImagesAndRewriteLinks(html: string, ctx: Ctx): Promise<string> {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`)

  // 1. Collect <img> with /api/files/<id> sources.
  const images = Array.from(document.querySelectorAll('img'))
  const targets: Array<{ el: Element; fileId: string }> = []
  for (const el of images) {
    const src = el.getAttribute('src') ?? ''
    const fileId = extractFileId(src)
    if (fileId) targets.push({ el, fileId })
  }

  if (targets.length > 0) {
    const ids = Array.from(new Set(targets.map((t) => t.fileId)))
    const records = await ctx.prisma.file.findMany({
      where: { id: { in: ids } },
      select: { id: true, path: true, mimeType: true },
    })
    const byId = new Map(records.map((r) => [r.id, r] as const))

    await withLimit(targets, CONCURRENCY, async ({ el, fileId }) => {
      const rec = byId.get(fileId)
      if (!rec) return
      try {
        const stream = (await ctx.storage.get(rec.path)) as AsyncIterable<Uint8Array>
        const base64 = await streamToBase64(stream)
        el.setAttribute('src', `data:${rec.mimeType};base64,${base64}`)
      } catch (err) {
        console.warn('[page-export] image embed failed', { fileId, err: (err as Error).message })
      }
    })
  }

  // 2. Rewrite internal page links to absolute URLs.
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith(PAGE_PATH_PREFIX) || href.startsWith(NEUTRAL_PAGE_PATH_PREFIX)) {
      a.setAttribute('href', `${ctx.baseUrl}${href}`)
    } else if (href.startsWith(FILE_PATH_PREFIX)) {
      a.setAttribute('href', `${ctx.baseUrl}${href}`)
    }
  }

  // 3. Rewrite file-attachment data-url to absolute.
  for (const div of Array.from(document.querySelectorAll('[data-type="file-attachment"]'))) {
    const url = div.getAttribute('data-url') ?? ''
    if (url.startsWith(FILE_PATH_PREFIX)) {
      div.setAttribute('data-url', `${ctx.baseUrl}${url}`)
    }
  }

  return document.body.innerHTML
}
