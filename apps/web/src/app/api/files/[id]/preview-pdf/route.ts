import { Readable } from 'node:stream'

import { GotenbergTimeoutError, officeToPdf } from '@repo/page-export'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'

import { authorizeFileRead } from '@/lib/file-access'
import { resolvePreviewType } from '@/lib/preview-kind'

export const runtime = 'nodejs'

// Office-файл → PDF для просмотрщика (spec §6). Результат детерминирован
// содержимым (файлы content-addressed по hash), поэтому кэшируется в S3
// навсегда; авторизация — та же, что у /api/files/[id].

const pdfHeaders = (extra?: Record<string, string>) => ({
  'Content-Type': 'application/pdf',
  'Content-Disposition': 'inline; filename="preview.pdf"',
  'Cache-Control': 'private, max-age=86400',
  'X-Content-Type-Options': 'nosniff',
  ...extra,
})

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const access = await authorizeFileRead(id)
  if (!access.ok) return access.response
  const file = access.file

  if (resolvePreviewType(file.mimeType, file.ext) !== 'office') {
    return new Response('Unsupported media type', { status: 415 })
  }

  const cacheKey = `preview-pdf/${file.hash || file.id}.pdf`

  if (await storage.exists(cacheKey).catch(() => false)) {
    const cached = (await storage.get(cacheKey)) as Readable
    const stream = Readable.toWeb(cached) as unknown as ReadableStream<Uint8Array>
    return new Response(stream, { status: 200, headers: pdfHeaders() })
  }

  let source: Readable
  try {
    source = (await storage.get(file.path)) as Readable
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const chunks: Buffer[] = []
  for await (const chunk of source) chunks.push(chunk as Buffer)
  const bytes = Uint8Array.from(Buffer.concat(chunks))

  const filename = file.ext ? `${file.name}.${file.ext}` : file.name

  let pdfStream: ReadableStream<Uint8Array>
  try {
    pdfStream = await officeToPdf(bytes, filename)
  } catch (err) {
    if (err instanceof GotenbergTimeoutError) {
      return new Response('PDF service timeout', { status: 504 })
    }
    return new Response('PDF service unavailable', { status: 502 })
  }

  // Буферизуем PDF, чтобы одновременно закэшировать и отдать (office-вложения
  // ≤ 50MB, результат обычно меньше исходника).
  const pdfBytes = Buffer.from(await new Response(pdfStream).arrayBuffer())
  await storage
    .put(cacheKey, pdfBytes, { contentType: 'application/pdf', size: pdfBytes.length })
    .catch(() => {
      // best-effort кэш: конвертация уже удалась, отдаём результат
    })

  return new Response(pdfBytes, {
    status: 200,
    headers: pdfHeaders({ 'Content-Length': String(pdfBytes.length) }),
  })
}
