// Общая read-авторизация файла для /api/files/[id] и /api/files/[id]/preview-pdf.
// Дословный перенос логики из files/[id]/route.ts — поведение не менялось.

import { prisma } from '@repo/db'

import { getSession } from '@/lib/get-session'

type FileRecord = NonNullable<Awaited<ReturnType<typeof prisma.file.findUnique>>>

export type FileReadResult = { ok: true; file: FileRecord } | { ok: false; response: Response }

export async function authorizeFileRead(id: string): Promise<FileReadResult> {
  const file = await prisma.file.findUnique({ where: { id } })
  if (!file || file.status !== 'ACTIVE') {
    return { ok: false, response: new Response('Not found', { status: 404 }) }
  }

  if (file.expiresAt && file.expiresAt.getTime() < Date.now()) {
    return { ok: false, response: new Response('Gone', { status: 410 }) }
  }

  if (!file.isPublic) {
    const session = await getSession()
    if (!session) return { ok: false, response: new Response('Unauthorized', { status: 401 }) }
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
        return { ok: false, response: new Response('Forbidden', { status: 403 }) }
      }
    }
  }

  return { ok: true, file }
}
