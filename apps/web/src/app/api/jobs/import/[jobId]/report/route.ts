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

  // Owner-only: the journal can name skipped private items, so even workspace
  // admins must not fetch another user's report. Deliberately NO status filter —
  // the journal matters most for FAILED jobs. All failure modes are a uniform
  // 404 (no existence leak).
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, userId: session.user.id },
    include: { artifacts: { include: { file: true } } },
  })
  const file = job?.artifacts.find((a) => a.kind === 'REPORT')?.file
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
  const filename = encodeURIComponent(`import-report-${jobId.slice(0, 8)}.txt`)

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': file.fileSize.toString(),
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
