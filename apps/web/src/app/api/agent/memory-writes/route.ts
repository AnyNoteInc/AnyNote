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
    await prisma.workspaceAgentMemory.upsert({
      where: {
        workspaceId_scope_userId_key: {
          workspaceId: e.workspaceId,
          scope: e.scope,
          // Prisma compound unique supports null for nullable columns — cast required
          userId: scopedUserId as string,
          key: e.key,
        },
      },
      create: {
        workspaceId: e.workspaceId,
        scope: e.scope,
        userId: scopedUserId,
        key: e.key,
        content: e.content,
        source: 'AGENT',
      },
      update: { content: e.content },
    })
  }
  return NextResponse.json({ written: parsed.data.entries.length })
}
