import { createHash } from "node:crypto"

import { Prisma, prisma } from "@repo/db"
import { storage } from "@repo/storage"

import { getSession } from "@/lib/get-session"
import {
  computeS3Key,
  extractExt,
  validateUpload,
  type UploadKind,
} from "@/lib/file-validation"

export const runtime = "nodejs"

const isAvatarMime = (mime: string): boolean =>
  mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" || mime === "image/gif"

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const kindParam = url.searchParams.get("kind")
  const workspaceIdParam = url.searchParams.get("workspaceId")

  if (kindParam !== "avatar" && kindParam !== "attachment") {
    return Response.json({ error: "Invalid kind" }, { status: 400 })
  }
  const kind: UploadKind = kindParam

  if (kind === "avatar" && workspaceIdParam) {
    return Response.json({ error: "workspaceId not allowed for avatar" }, { status: 400 })
  }
  if (kind === "attachment" && !workspaceIdParam) {
    return Response.json({ error: "workspaceId is required for attachment" }, { status: 400 })
  }

  if (kind === "attachment") {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspaceIdParam!,
          userId: session.user.id,
        },
      },
    })
    if (!member) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file field" }, { status: 400 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const mimeType = file.type || "application/octet-stream"

  const validationError = validateUpload(kind, bytes.length, mimeType)
  if (validationError) {
    return Response.json({ error: validationError.message }, { status: validationError.status })
  }

  if (kind === "avatar" && !isAvatarMime(mimeType)) {
    return Response.json({ error: "Avatar mime must be an image" }, { status: 400 })
  }

  const hash = createHash("sha256").update(bytes).digest("hex")
  const ext = extractExt(file.name)
  const s3Key = computeS3Key(hash, ext)

  const workspaceId = kind === "attachment" ? workspaceIdParam : null

  const existing = await prisma.file.findFirst({
    where: {
      userId: session.user.id,
      hash,
      workspaceId,
      status: "ACTIVE",
    },
  })

  let fileRow = existing
  if (!fileRow) {
    if (!(await storage.exists(s3Key))) {
      await storage.put(s3Key, bytes, { contentType: mimeType, size: bytes.length })
    }
    try {
      fileRow = await prisma.file.create({
        data: {
          userId: session.user.id,
          workspaceId,
          name: file.name,
          ext,
          fileSize: BigInt(bytes.length),
          mimeType,
          hash,
          path: s3Key,
          status: "ACTIVE",
          isPublic: kind === "avatar",
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        fileRow = await prisma.file.findFirst({
          where: {
            userId: session.user.id,
            hash,
            workspaceId,
            status: "ACTIVE",
          },
        })
        if (!fileRow) {
          return Response.json({ error: "Upload conflict" }, { status: 409 })
        }
      } else {
        throw err
      }
    }
  }

  let imageUrl: string | undefined
  if (kind === "avatar") {
    imageUrl = `/api/files/${fileRow.id}`
    await prisma.user.update({
      where: { id: session.user.id },
      data: { image: imageUrl },
    })
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
