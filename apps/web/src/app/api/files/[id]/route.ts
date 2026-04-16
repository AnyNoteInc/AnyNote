import { Readable } from "node:stream"

import { prisma } from "@repo/db"
import { storage } from "@repo/storage"
import type { NextRequest } from "next/server"

import { getSession } from "@/lib/get-session"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const file = await prisma.file.findUnique({ where: { id } })
  if (!file || file.status !== "ACTIVE") {
    return new Response("Not found", { status: 404 })
  }

  if (file.expiresAt && file.expiresAt.getTime() < Date.now()) {
    return new Response("Gone", { status: 410 })
  }

  if (!file.isPublic) {
    const session = await getSession()
    if (!session) return new Response("Unauthorized", { status: 401 })
    if (session.user.id !== file.userId) {
      return new Response("Forbidden", { status: 403 })
    }
  }

  let body: Readable
  try {
    body = (await storage.get(file.path)) as Readable
  } catch {
    return new Response("Not found", { status: 404 })
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
  const disposition = `inline; filename="${filenameStar}"; filename*=UTF-8''${filenameStar}`

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": file.fileSize.toString(),
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=0",
    },
  })
}
