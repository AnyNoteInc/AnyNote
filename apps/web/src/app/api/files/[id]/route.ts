import { Readable } from 'node:stream'

import { prisma } from '@repo/db'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'

import { authorizeFileRead } from '@/lib/file-access'
import { isInlineSafeMime } from '@/lib/file-validation'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const access = await authorizeFileRead(id)
  if (!access.ok) return access.response
  const file = access.file

  let body: Readable
  try {
    body = (await storage.get(file.path)) as Readable
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const stream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>

  // fire-and-forget increment
  void prisma.file
    .update({
      where: { id: file.id },
      data: { downloadCount: { increment: 1 } },
    })
    .catch(() => {
      /* swallow — download already streaming */
    })

  const filenameStem = file.ext ? `${file.name}.${file.ext}` : file.name
  const filenameStar = encodeURIComponent(filenameStem)
  // Attachments accept any declared MIME (file-validation.ts), and this route
  // serves them on the app origin — inline text/html or SVG here would be
  // same-origin stored XSS. Anything not on the inline-safe list downloads.
  const dispositionType = isInlineSafeMime(file.mimeType) ? 'inline' : 'attachment'
  const disposition = `${dispositionType}; filename="${filenameStar}"; filename*=UTF-8''${filenameStar}`

  // Public files (avatars/page icons/covers) are content-addressed per id —
  // the bytes behind an id never change, so browsers/CDNs may cache hard.
  const cacheControl = file.isPublic ? 'public, max-age=86400, immutable' : 'private, max-age=0'

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': file.fileSize.toString(),
      'Content-Disposition': disposition,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
