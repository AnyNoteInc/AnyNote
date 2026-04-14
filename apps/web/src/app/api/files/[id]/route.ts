import type { Readable } from "node:stream"

import { prisma } from "@repo/db"
import { storage } from "@repo/storage"

import { getSession } from "@/lib/get-session"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const body = (await storage.get(file.path)) as Readable
  const stream = new ReadableStream({
    start(controller) {
      body.on("data", (chunk: Buffer) => controller.enqueue(chunk))
      body.on("end", () => controller.close())
      body.on("error", (err) => {
        body.destroy()
        controller.error(err)
      })
    },
    cancel() {
      body.destroy()
    },
  })

  // fire-and-forget increment
  void prisma.file
    .update({
      where: { id: file.id },
      data: { downloadCount: { increment: 1 } },
    })
    .catch(() => {
      /* swallow — download already streaming */
    })

  const filenameSafe = encodeURIComponent(file.name)
  const disposition = file.ext
    ? `inline; filename="${filenameSafe}.${file.ext}"`
    : `inline; filename="${filenameSafe}"`

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
