import { prisma, Prisma } from '@repo/db'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { signAgentsJwt, type AgentsRole } from '@/lib/agents-token'
import { activeStreamRegistry } from '@/lib/chat/active-stream-registry'
import type { ServiceBlock } from '@/lib/chat/types'
import {
  createEntryResponse,
  streamAgentSseToRegistry,
} from '@/lib/chat/agent-sse-bridge'
import { getSession } from '@/lib/get-session'

export const runtime = 'nodejs'

const bodySchema = z.object({
  chatId: z.string().uuid(),
  confirmationId: z.string().min(1),
  action: z.enum(['allow', 'deny']),
})

type PersistedPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; kind: 'tool' | 'confirmation'; state: ServiceBlock['state']; title: string; detail?: string; result?: string }
  | { type: string }

function isTextPart(p: PersistedPart): p is { type: 'text'; text: string } {
  return p.type === 'text'
}

function isToolPart(p: PersistedPart): p is Extract<PersistedPart, { type: 'tool' }> {
  return p.type === 'tool'
}

function resolveConfirmationBlock(
  part: Extract<PersistedPart, { type: 'tool' }>,
  action: 'allow' | 'deny',
): ServiceBlock {
  const state: ServiceBlock['state'] = action === 'allow' ? 'running' : 'done'
  const title = action === 'deny' ? `${part.title} — отклонено` : part.title
  return { id: part.id, kind: part.kind, state, title, detail: part.detail, result: part.result }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return new Response('unauthorized', { status: 401 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return new Response('bad request', { status: 400 })

  const { chatId, confirmationId, action } = parsed.data

  // Verify chat membership
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      workspace: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true, workspaceId: true },
  })
  if (!chat) return new Response('forbidden', { status: 403 })

  // Confirm membership role
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: chat.workspaceId, userId: session.user.id } },
    select: { role: true },
  })
  if (!membership) return new Response('forbidden', { status: 403 })

  // Find the assistant message that contains a confirmation block with this id.
  // Use raw SQL with Prisma.sql to safely query JSONB.
  // ORDER BY DESC is defensive — confirmation_ids are uuid4 so collisions are
  // astronomically unlikely, but if the same id ever recurs across messages we
  // resume against the most recent (which is the one currently shown to the user).
  type MessageRow = { id: string; parts: unknown }
  const rows = await prisma.$queryRaw<MessageRow[]>(
    Prisma.sql`
      SELECT id, parts
      FROM chat_messages
      WHERE chat_id = ${chatId}::uuid
        AND role = 'ASSISTANT'
        AND parts @> ${JSON.stringify([{ id: confirmationId, kind: 'confirmation' }])}::jsonb
      ORDER BY created_at DESC
      LIMIT 1
    `,
  )

  const messageRow = rows[0]
  if (!messageRow) return new Response('confirmation not found', { status: 404 })

  const assistantMessageId = messageRow.id
  const persistedParts = Array.isArray(messageRow.parts)
    ? (messageRow.parts as PersistedPart[])
    : []

  // Reset the message status back to STREAMING so the client sees a live stream
  await prisma.chatMessage.update({
    where: { id: assistantMessageId },
    data: { status: 'STREAMING', errorMessage: null },
  })

  // Mint a fresh agents JWT
  const jwt = await signAgentsJwt({
    userId: session.user.id,
    workspaceId: chat.workspaceId,
    chatId,
    role: membership.role as AgentsRole,
  })

  // Create a registry entry (no userMessageId — bubble already exists)
  const entry = activeStreamRegistry.create({
    assistantMessageId,
    chatId,
    userMessageId: '',
  })

  // Pre-seed the entry's ordered segments from the persisted parts so the
  // translator's upserts merge into the existing bubble rather than starting fresh.
  // While doing so, flip the confirmation block we just acted on: allow → running
  // (agent is now running the tool), deny → done. This removes the inline buttons
  // immediately and survives a page refresh because the debounced persist writes
  // the updated segments back to the chat message row.
  for (const part of persistedParts) {
    if (isTextPart(part)) {
      entry.segments.push({ type: 'text', text: part.text })
      continue
    }
    if (!isToolPart(part)) continue
    const isResolved = part.kind === 'confirmation' && part.id === confirmationId
    const block = isResolved
      ? resolveConfirmationBlock(part, action)
      : { id: part.id, kind: part.kind, state: part.state, title: part.title, detail: part.detail, result: part.result }
    entry.publishToolStatus(block)
  }

  const agentsUrl = process.env.AGENTS_URL ?? 'http://localhost:8080'
  const upstreamTask = streamAgentSseToRegistry({
    assistantMessageId,
    chatId,
    entry,
    jwt,
    upstreamUrl: `${agentsUrl}/agent/resume`,
    upstreamBody: {
      chat_id: chatId,
      confirmation_id: confirmationId,
      action,
    },
  })
  entry.setUpstreamTask(upstreamTask)

  // Push the resolved-confirmation segments immediately so the UI buttons
  // disappear before the agent even starts streaming events back.
  return createEntryResponse({
    entry,
    initialEvents: [{ type: 'message.segments', assistantMessageId, segments: entry.segments }],
  })
}
