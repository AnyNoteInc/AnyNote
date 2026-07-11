import { Readable } from 'node:stream'

import { prisma } from '@repo/db'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'

import { getSession } from '@/lib/get-session'
import { isInlineSafeMime } from '@/lib/file-validation'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const file = await prisma.file.findUnique({ where: { id } })
  if (!file || file.status !== 'ACTIVE') {
    return new Response('Not found', { status: 404 })
  }

  if (file.expiresAt && file.expiresAt.getTime() < Date.now()) {
    return new Response('Gone', { status: 410 })
  }

  if (!file.isPublic) {
    const session = await getSession()
    if (!session) return new Response('Unauthorized', { status: 401 })
    if (session.user.id !== file.userId) {
      // Allow download if the file is an ACTIVE file in a workspace the user belongs to…
      let authorized = false

      if (file.workspaceId && file.status === 'ACTIVE') {
        const member = await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: file.workspaceId,
              userId: session.user.id,
            },
          },
          select: { userId: true },
        })
        if (member) {
          // Active membership only: a workspace block kills file access. Inline
          // one-liner mirror of @repo/domain `PeopleService.isWorkspaceBlocked`.
          const blocked = await prisma.workspaceBlockedUser.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: file.workspaceId,
                userId: session.user.id,
              },
            },
            select: { id: true },
          })
          if (!blocked) authorized = true
        }
      }

      // …or attached to a page in a workspace the user belongs to (and is not blocked in).
      if (!authorized) {
        const linked = await prisma.pageFile.findFirst({
          where: {
            fileId: file.id,
            page: {
              deletedAt: null,
              workspace: {
                members: { some: { userId: session.user.id } },
                blockedUsers: { none: { userId: session.user.id } },
              },
            },
          },
          select: { pageId: true },
        })
        if (linked) authorized = true
      }

      if (!authorized) {
        return new Response('Forbidden', { status: 403 })
      }
    }
  }

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
