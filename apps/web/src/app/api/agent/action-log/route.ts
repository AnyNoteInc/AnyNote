import { Prisma, prisma } from '@repo/db'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { verifyAgentsCallback } from '@/lib/agents-token'

export const runtime = 'nodejs'

const entrySchema = z.object({
  chatId: z.string().uuid().nullable().optional(),
  messageId: z.string().uuid().nullable().optional(),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  toolName: z.string(),
  toolInput: z.unknown(),
  toolOutput: z.unknown().nullable().optional(),
  status: z.enum(['OK', 'ERROR', 'DENIED']),
  durationMs: z.number().int().min(0),
  errorMessage: z.string().nullable().optional(),
})

const bodySchema = z.object({ entries: z.array(entrySchema).min(1).max(100) })

export async function POST(req: NextRequest) {
  const authz = req.headers.get('authorization') ?? ''
  const claims = await verifyAgentsCallback(authz)
  if (!claims) return new NextResponse('unauthorized', { status: 401 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return new NextResponse('bad request', { status: 400 })

  // Enforce that every entry belongs to the JWT's workspace and user
  for (const e of parsed.data.entries) {
    if (e.workspaceId !== claims.wsid || e.userId !== claims.sub) {
      return new NextResponse('forbidden', { status: 403 })
    }
  }

  await prisma.agentActionLog.createMany({
    data: parsed.data.entries.map((e) => ({
      chatId: e.chatId ?? null,
      messageId: e.messageId ?? null,
      workspaceId: e.workspaceId,
      userId: e.userId,
      toolName: e.toolName,
      toolInput: e.toolInput as object,
      toolOutput: e.toolOutput != null ? (e.toolOutput as Prisma.InputJsonValue) : Prisma.JsonNull,
      status: e.status,
      durationMs: e.durationMs,
      errorMessage: e.errorMessage ?? null,
    })),
  })

  return NextResponse.json({ accepted: parsed.data.entries.length }, { status: 202 })
}
