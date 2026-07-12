import { Readable } from 'node:stream'

import { GotenbergTimeoutError, GotenbergUpstreamError, officeToPdf } from '@repo/page-export'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'

import { authorizeFileRead } from '@/lib/file-access'
import { resolvePreviewType } from '@/lib/preview-kind'

export const runtime = 'nodejs'

// Office-файл → PDF для просмотрщика (spec §6). Результат детерминирован
// содержимым (файлы content-addressed по hash), поэтому кэшируется в S3
// навсегда; авторизация — та же, что у /api/files/[id].

// Office-вложения капятся 50MB на аплоаде (attachment kind); дублируем ceiling
// здесь, т.к. resolvePreviewType классифицирует по MIME/ext, не по upload-kind.
const MAX_PREVIEW_SOURCE_BYTES = 50 * 1024 * 1024

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

  if (file.fileSize > BigInt(MAX_PREVIEW_SOURCE_BYTES)) {
    return new Response('Payload too large', { status: 413 })
  }

  const cacheKey = `preview-pdf/${file.hash || file.id}.pdf`

  if (await storage.exists(cacheKey).catch(() => false)) {
    try {
      const cached = await storage.get(cacheKey)
      const stream = Readable.toWeb(cached) as unknown as ReadableStream<Uint8Array>
      return new Response(stream, { status: 200, headers: pdfHeaders() })
    } catch {
      // Кэш испарился между exists и get (или transient) — регенерируем ниже.
    }
  }

  let bytes: Uint8Array<ArrayBuffer>
  try {
    const source = await storage.get(file.path)
    const chunks: Buffer[] = []
    for await (const chunk of source) chunks.push(chunk as Buffer)
    // Zero-copy view (Buffer.concat уже даёт непрерывный буфер) — без второй копии.
    const buf = Buffer.concat(chunks)
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const filename = file.ext ? `${file.name}.${file.ext}` : file.name

  let pdfStream: ReadableStream<Uint8Array>
  try {
    pdfStream = await officeToPdf(bytes, filename)
  } catch (err) {
    if (err instanceof GotenbergTimeoutError) {
      return new Response('PDF service timeout', { status: 504 })
    }
    if (err instanceof GotenbergUpstreamError) {
      return new Response('Document could not be converted', { status: 422 })
    }
    return new Response('PDF service unavailable', { status: 502 })
  }

  // Буферизуем PDF, чтобы одновременно закэшировать и отдать (office-вложения
  // ≤ 50MB, результат обычно меньше исходника).
  const pdfBytes = Buffer.from(await new Response(pdfStream).arrayBuffer())
  await storage
    .put(cacheKey, pdfBytes, { contentType: 'application/pdf', size: pdfBytes.length })
    .catch((err) => {
      // best-effort кэш: конвертация удалась, отдаём результат; но логируем,
      // иначе перманентно сломанный кэш молча реконвертит на каждый запрос.
      console.warn('[preview-pdf] cache put failed', err)
    })

  return new Response(pdfBytes, {
    status: 200,
    headers: pdfHeaders({ 'Content-Length': String(pdfBytes.length) }),
  })
}
