import { createHash } from 'node:crypto'

import { FileStatus, Prisma, prisma } from '@repo/db'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'

import { getSession } from '@/lib/get-session'
import { computeS3Key, extractExt, validateUpload, type UploadKind } from '@/lib/file-validation'

export const runtime = 'nodejs'

const setUserAvatar = (userId: string, fileId: string) =>
  prisma.user.update({
    where: { id: userId },
    data: { image: `/api/files/${fileId}` },
  })

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const kindParam = request.nextUrl.searchParams.get('kind')
  const workspaceIdParam = request.nextUrl.searchParams.get('workspaceId')

  if (kindParam !== 'avatar' && kindParam !== 'attachment') {
    return Response.json({ error: 'Invalid kind' }, { status: 400 })
  }
  const kind: UploadKind = kindParam

  if (kind === 'avatar' && workspaceIdParam) {
    return Response.json({ error: 'workspaceId not allowed for avatar' }, { status: 400 })
  }
  if (kind === 'attachment' && !workspaceIdParam) {
    return Response.json({ error: 'workspaceId is required for attachment' }, { status: 400 })
  }

  if (kind === 'attachment') {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspaceIdParam!,
          userId: session.user.id,
        },
      },
    })
    if (!member) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing file field' }, { status: 400 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const mimeType = file.type || 'application/octet-stream'

  const validationError = validateUpload(kind, bytes.length, mimeType)
  if (validationError) {
    return Response.json({ error: validationError.message }, { status: validationError.status })
  }

  if (kind === 'attachment') {
    const [usage, limits] = await Promise.all([
      prisma.file.aggregate({
        where: { workspaceId: workspaceIdParam!, status: FileStatus.ACTIVE },
        _sum: { fileSize: true },
      }),
      prisma.workspaceLimit.findUnique({ where: { workspaceId: workspaceIdParam! } }),
    ])
    if (!limits) {
      return Response.json({ error: 'WORKSPACE_LIMIT_MISSING' }, { status: 500 })
    }
    const used = usage._sum.fileSize ?? 0n
    if (used + BigInt(bytes.length) > limits.maxFileBytes) {
      return Response.json(
        { error: 'WORKSPACE_STORAGE_LIMIT', maxBytes: limits.maxFileBytes.toString() },
        { status: 413 },
      )
    }
  }

  const hash = createHash('sha256').update(bytes).digest('hex')
  const ext = extractExt(file.name)
  const s3Key = computeS3Key(hash, ext)

  const workspaceId = kind === 'attachment' ? workspaceIdParam : null

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
            isPublic: kind === 'avatar',
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
        throw err
      }
    }
  } else if (kind === 'avatar') {
    // Dedup hit on the initial findFirst: existing row, update User.image
    await setUserAvatar(session.user.id, fileRow.id)
  }

  let imageUrl: string | undefined
  if (kind === 'avatar' && fileRow) {
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
