import { prisma } from '@repo/db'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { verifyAgentsCallback } from '@/lib/agents-token'

export const runtime = 'nodejs'

const entry = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  scope: z.enum(['WORKSPACE', 'USER']),
  key: z.string().min(1).max(120),
  content: z.string().min(1).max(4000),
})
const body = z.object({ entries: z.array(entry).min(1).max(20) })

export async function POST(req: NextRequest) {
  const claims = await verifyAgentsCallback(req.headers.get('authorization') ?? '')
  if (!claims) return new NextResponse('unauthorized', { status: 401 })

  const parsed = body.safeParse(await req.json())
  if (!parsed.success) return new NextResponse('bad request', { status: 400 })

  for (const e of parsed.data.entries) {
    if (e.workspaceId !== claims.wsid || e.userId !== claims.sub) {
      return new NextResponse('forbidden', { status: 403 })
    }
    const scopedUserId = e.scope === 'USER' ? e.userId : null
    // Prisma's compound-unique upsert can't match rows where userId IS NULL
    // (SQL null comparison). Find + update or create explicitly.
    const existing = await prisma.workspaceAgentMemory.findFirst({
      where: {
        workspaceId: e.workspaceId,
        scope: e.scope,
        userId: scopedUserId,
        key: e.key,
      },
      select: { id: true },
    })
    if (existing) {
      await prisma.workspaceAgentMemory.update({
        where: { id: existing.id },
        data: { content: e.content },
      })
    } else {
      await prisma.workspaceAgentMemory.create({
        data: {
          workspaceId: e.workspaceId,
          scope: e.scope,
          userId: scopedUserId,
          key: e.key,
          content: e.content,
          source: 'AGENT',
        },
      })
    }
  }
  return NextResponse.json({ written: parsed.data.entries.length })
}
