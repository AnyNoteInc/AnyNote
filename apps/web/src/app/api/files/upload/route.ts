import { createHash } from 'node:crypto'

import { FileStatus, Prisma, prisma } from '@repo/db'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'

import { getActiveWorkspaceForUser } from '@/lib/active-workspace'
import { getSession } from '@/lib/get-session'
import { UUID_RE } from '@/lib/uuid'
import {
  computeS3Key,
  extractExt,
  mediaMimeMatchesSniff,
  sniffImageMime,
  validateUpload,
  type UploadKind,
} from '@/lib/file-validation'

export const runtime = 'nodejs'

class WorkspaceLimitMissingError extends Error {}

class WorkspaceStorageLimitError extends Error {
  constructor(readonly maxBytes: bigint) {
    super('WORKSPACE_STORAGE_LIMIT')
  }
}

async function assertWorkspaceStorageCapacity(
  client: Pick<Prisma.TransactionClient, 'file' | 'workspaceLimit'>,
  workspaceId: string,
  newBytes: number,
  now = new Date(),
): Promise<void> {
  const usage = await client.file.aggregate({
    where: {
      workspaceId,
      OR: [{ status: FileStatus.ACTIVE }, { status: FileStatus.PENDING, expiresAt: { gt: now } }],
    },
    _sum: { fileSize: true },
  })
  const limits = await client.workspaceLimit.findUnique({ where: { workspaceId } })
  if (!limits) throw new WorkspaceLimitMissingError('WORKSPACE_LIMIT_MISSING')
  if ((usage._sum.fileSize ?? 0n) + BigInt(newBytes) > limits.maxFileBytes) {
    throw new WorkspaceStorageLimitError(limits.maxFileBytes)
  }
}

function workspaceLimitResponse(error: unknown): Response | null {
  if (error instanceof WorkspaceLimitMissingError) {
    return Response.json({ error: 'WORKSPACE_LIMIT_MISSING' }, { status: 500 })
  }
  if (error instanceof WorkspaceStorageLimitError) {
    return Response.json(
      { error: 'WORKSPACE_STORAGE_LIMIT', maxBytes: error.maxBytes.toString() },
      { status: 413 },
    )
  }
  return null
}

const setUserAvatar = (userId: string, fileId: string) =>
  prisma.user.update({
    where: { id: userId },
    data: { image: `/api/files/${fileId}` },
  })

/** Workspace for a quota-counted upload. An explicit `workspaceId` pins the
 *  file to the caller's context (page chat binds to the PAGE's workspace,
 *  which can diverge from the stored active workspace — другой таб, гостевая
 *  страница) and is membership-gated; without it the legacy active-workspace
 *  resolution stays. */
async function resolveUploadWorkspace(
  userId: string,
  requestedWorkspaceId: string | null,
): Promise<{ id: string } | { error: string; status: number }> {
  if (requestedWorkspaceId !== null) {
    if (!UUID_RE.test(requestedWorkspaceId)) {
      return { error: 'Invalid workspaceId', status: 400 }
    }
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: requestedWorkspaceId,
        members: { some: { userId } },
        blockedUsers: { none: { userId } },
      },
      select: { id: true },
    })
    return workspace ?? { error: 'Нет доступа к пространству', status: 403 }
  }
  const active = await getActiveWorkspaceForUser(userId)
  return active ? { id: active.id } : { error: 'No active workspace', status: 400 }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const kindParam = request.nextUrl.searchParams.get('kind')

  if (
    kindParam !== 'avatar' &&
    kindParam !== 'attachment' &&
    kindParam !== 'icon' &&
    kindParam !== 'cover' &&
    kindParam !== 'media'
  ) {
    return Response.json({ error: 'Invalid kind' }, { status: 400 })
  }
  const kind: UploadKind = kindParam

  // Page-appearance kinds (icon/cover) mirror the avatar semantics: isPublic
  // true (served by unguessable UUID to anyone — they must render on public
  // shares) and workspaceId null, which makes them quota-exempt like avatars.
  // The small per-file caps in validateUpload bound abuse.
  const isPublicKind = kind === 'avatar' || kind === 'icon' || kind === 'cover'
  // Quota-counted, auth-gated kinds: bound to the active workspace and summed
  // against the workspace storage limit (NOT public). Media joins attachment.
  const isWorkspaceKind = kind === 'attachment' || kind === 'media'

  let workspaceScopedId: string | null = null
  if (isWorkspaceKind) {
    const resolved = await resolveUploadWorkspace(
      session.user.id,
      request.nextUrl.searchParams.get('workspaceId'),
    )
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status })
    }
    workspaceScopedId = resolved.id
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing file field' }, { status: 400 })
  }

  // NOTE: the whole file is buffered into memory here before validation/hashing.
  // The `media` kind allows up to 200MB (file-validation.ts), so this route's
  // peak heap is bounded by that cap × concurrent uploads — operators must size
  // Node heap and the reverse-proxy (Traefik) request-body limit to accommodate
  // it (Traefik v3 does not cap bodies by default; see the INFRA NOTE on
  // MEDIA_MAX_BYTES). Streaming straight to S3 would remove the buffer but is a
  // larger change than this fix scope.
  const bytes = Buffer.from(await file.arrayBuffer())
  const mimeType = file.type || 'application/octet-stream'

  const validationError = validateUpload(kind, bytes.length, mimeType)
  if (validationError) {
    return Response.json({ error: validationError.message }, { status: validationError.status })
  }

  // The declared MIME is client-controlled; for the public image kinds verify
  // the magic bytes actually match it (unknown or lying content ⇒ 400).
  if (isPublicKind && sniffImageMime(bytes) !== mimeType) {
    return Response.json({ error: 'Файл не является изображением' }, { status: 400 })
  }

  // Media is embedded in `<video>`/`<audio>` players; verify the bytes are a
  // media container whose family matches the declared MIME (HTML-as-mp4 ⇒ 400).
  if (kind === 'media' && !mediaMimeMatchesSniff(mimeType, bytes)) {
    return Response.json({ error: 'Файл не является видео или аудио' }, { status: 400 })
  }

  if (isWorkspaceKind) {
    try {
      await assertWorkspaceStorageCapacity(prisma, workspaceScopedId!, bytes.length)
    } catch (error) {
      const response = workspaceLimitResponse(error)
      if (response) return response
      throw error
    }
  }

  const hash = createHash('sha256').update(bytes).digest('hex')
  const ext = extractExt(file.name)
  const s3Key = computeS3Key(hash, ext)

  const workspaceId = isWorkspaceKind ? workspaceScopedId : null

  const existing = await prisma.file.findFirst({
    where: {
      userId: session.user.id,
      hash,
      workspaceId,
      status: FileStatus.ACTIVE,
    },
  })

  let fileRow = existing
  if (!fileRow) {
    await storage.put(s3Key, bytes, { contentType: mimeType, size: bytes.length })

    try {
      fileRow = await prisma.$transaction(async (tx) => {
        if (workspaceId !== null) {
          const workspaces = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM workspaces
            WHERE id = ${workspaceId}::uuid
            FOR UPDATE
          `
          if (workspaces.length !== 1) throw new WorkspaceLimitMissingError()
          await assertWorkspaceStorageCapacity(tx, workspaceId, bytes.length)
        }
        const created = await tx.file.create({
          data: {
            userId: session.user.id,
            workspaceId,
            name: file.name,
            ext,
            fileSize: BigInt(bytes.length),
            mimeType,
            hash,
            path: s3Key,
            status: FileStatus.ACTIVE,
            isPublic: isPublicKind,
          },
        })
        if (kind === 'avatar') {
          await tx.user.update({
            where: { id: session.user.id },
            data: { image: `/api/files/${created.id}` },
          })
        }
        return created
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        fileRow = await prisma.file.findFirst({
          where: {
            userId: session.user.id,
            hash,
            workspaceId,
            status: FileStatus.ACTIVE,
          },
        })
        if (!fileRow) {
          return Response.json({ error: 'Upload conflict' }, { status: 409 })
        }
        // Dedup recovery: point User.image at the existing row if avatar
        if (kind === 'avatar') {
          await setUserAvatar(session.user.id, fileRow.id)
        }
      } else {
        const response = workspaceLimitResponse(err)
        if (response) return response
        throw err
      }
    }
  } else if (kind === 'avatar') {
    // Dedup hit on the initial findFirst: existing row, update User.image
    await setUserAvatar(session.user.id, fileRow.id)
  }

  // All public kinds answer with the public-by-id URL — the avatar flow stores
  // it on User.image above; icon/cover callers write it into Page.icon/coverUrl.
  let imageUrl: string | undefined
  if (isPublicKind && fileRow) {
    imageUrl = `/api/files/${fileRow.id}`
  }

  return Response.json({
    file: {
      id: fileRow.id,
      name: fileRow.name,
      ext: fileRow.ext,
      mimeType: fileRow.mimeType,
      fileSize: fileRow.fileSize.toString(),
      isPublic: fileRow.isPublic,
      createdAt: fileRow.createdAt.toISOString(),
    },
    imageUrl,
  })
}
