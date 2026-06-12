import { Readable } from 'node:stream'

import { prisma } from '@repo/db'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/lib/get-session'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params
  if (!z.string().uuid().safeParse(jobId).success) return new Response('Not found', { status: 404 })

  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  // Owner-only: a workspace export may contain the creator's personal pages, so
  // even workspace admins must not fetch another user's artifact. All failure
  // modes are a uniform 404 (no existence leak).
  //
  // Deliberately NOT gated on the security policy's disableExport (8C §4): the
  // artifact was created while exporting was still allowed, it is scoped to the
  // very user who made it, and revoking the download would strand data the user
  // already extracted. The policy blocks creating NEW exports (job.export.create
  // and both GET export routes), not collecting finished ones.
  const job = await prisma.exportJob.findFirst({
    where: { id: jobId, userId: session.user.id, status: 'DONE' },
    include: { artifacts: { include: { file: true } } },
  })
  const file = job?.artifacts[0]?.file
  if (!file || file.status !== 'ACTIVE') return new Response('Not found', { status: 404 })
  if (file.expiresAt && file.expiresAt.getTime() < Date.now()) {
    return new Response('Not found', { status: 404 })
  }

  let body: Readable
  try {
    body = (await storage.get(file.path)) as Readable
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const stream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>
  const filename = encodeURIComponent(`anynote-export-${jobId.slice(0, 8)}.zip`)

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': file.fileSize.toString(),
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
