import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma, type RoleType } from '@repo/db'
import { getSession } from '@/lib/get-session'
import { signAgentsJwt, type AgentsRole } from '@/lib/agents-token'

export const runtime = 'nodejs'

const bodySchema = z.object({
  chatId: z.string().uuid(),
  confirmationId: z.string().min(1),
  action: z.enum(['allow', 'deny']),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return new Response('unauthorized', { status: 401 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return new Response('bad request', { status: 400 })

  const chat = await prisma.chat.findUnique({
    where: { id: parsed.data.chatId },
    select: {
      workspaceId: true,
      workspace: { include: { members: { where: { userId: session.user.id } } } },
    },
  })
  if (!chat || chat.workspace.members.length === 0) {
    return new Response('forbidden', { status: 403 })
  }
  const member = chat.workspace.members[0]!
  const role = member.role as RoleType

  const jwt = await signAgentsJwt({
    userId: session.user.id,
    workspaceId: chat.workspaceId,
    chatId: parsed.data.chatId,
    role: role as AgentsRole,
  })

  const upstream = await fetch(
    `${process.env.AGENTS_URL ?? 'http://localhost:8080'}/agent/resume`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        chat_id: parsed.data.chatId,
        confirmation_id: parsed.data.confirmationId,
        action: parsed.data.action,
      }),
    },
  )
  if (!upstream.body) return new Response('agents unreachable', { status: 502 })
  return new Response(upstream.body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
  })
}
