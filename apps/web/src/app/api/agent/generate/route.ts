import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma, type RoleType } from '@repo/db'
import { getSession } from '@/lib/get-session'
import { signAgentsJwt, type AgentsRole } from '@/lib/agents-token'
import {
  decryptModelConnection,
  decryptMcpHeadersMap,
} from '@/lib/decrypt-workspace-secrets'

export const runtime = 'nodejs'

const bodySchema = z.object({
  chatId: z.string().uuid(),
  messageText: z.string().min(1).max(8000),
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

  const [ai, mcpServers, history, memories] = await Promise.all([
    prisma.workspaceAiSettings.findUnique({
      where: { workspaceId: chat.workspaceId },
      include: {
        defaultModel: { include: { provider: true } },
        embeddingsModel: { include: { provider: true } },
      },
    }),
    prisma.workspaceMcpServer.findMany({
      where: { workspaceId: chat.workspaceId, enabled: true },
    }),
    prisma.chatMessage.findMany({
      where: { chatId: parsed.data.chatId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    searchMemoriesLexical({
      workspaceId: chat.workspaceId,
      userId: session.user.id,
      query: parsed.data.messageText,
      k: 5,
    }),
  ])
  if (!ai) return new Response('workspace ai settings missing', { status: 412 })

  await prisma.chatMessage.create({
    data: {
      chatId: parsed.data.chatId,
      role: 'USER',
      status: 'DONE',
      parts: [{ type: 'text', text: parsed.data.messageText }] as object,
    },
  })

  const jwt = await signAgentsJwt({
    userId: session.user.id,
    workspaceId: chat.workspaceId,
    chatId: parsed.data.chatId,
    role: role as AgentsRole,
  })

  const decryptedChatConn = decryptModelConnection(ai.chatModelConnection)
  const decryptedEmbedConn = decryptModelConnection(ai.embeddingModelConnection)
  const decryptedMcp = decryptMcpHeadersMap(
    mcpServers.map((s) => ({ id: s.id, headers: s.headers })),
  )

  const enginesAuth = await signEnginesHeaders({
    userId: session.user.id,
    workspaceId: chat.workspaceId,
  })

  const defaultModel = ai.defaultModel
  const embeddingsModel = ai.embeddingsModel

  const payload = {
    chat_id: parsed.data.chatId,
    user_message: parsed.data.messageText,
    chat_history: history
      .reverse()
      .map((m) => ({
        role: m.role.toLowerCase(),
        content: extractText(m.parts as object),
      })),
    model: defaultModel
      ? {
          provider: defaultModel.provider.slug,
          name: defaultModel.slug,
          connection: decryptedChatConn ?? {},
          settings: { temperature: ai.temperature, topP: ai.topP },
        }
      : null,
    embedding:
      embeddingsModel && embeddingsModel.vectorSize != null
        ? {
            provider: embeddingsModel.provider.slug,
            modelSlug: embeddingsModel.slug,
            vectorSize: embeddingsModel.vectorSize,
            connection: decryptedEmbedConn ?? {},
          }
        : null,
    mcp: {
      servers: [
        {
          name: 'anynote',
          description: 'AnyNote engines MCP',
          url: process.env.ENGINES_MCP_URL ?? '',
          transport: 'HTTP_JSONRPC',
          headers: enginesAuth,
          tools: [],
        },
        ...mcpServers.map((s) => ({
          name: s.name,
          description: s.description ?? '',
          url: s.url,
          transport: s.transport,
          headers: decryptedMcp[s.id] ?? {},
          tools: s.toolsAllowlist,
        })),
      ],
    },
    agent_system_prompt: ai.agentSystemPrompt,
    long_term_memories: memories,
    allow_destructive: ai.allowDestructive,
  }

  const upstream = await fetch(`${process.env.AGENTS_URL ?? 'http://localhost:8080'}/agent/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(payload),
  })
  if (!upstream.body) return new Response('agents service unreachable', { status: 502 })
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
    },
  })
}

function extractText(parts: object): string {
  const arr = Array.isArray(parts) ? parts : []
  return (arr as Array<{ type?: string; text?: string }>)
    .filter((p) => p?.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n')
}

async function searchMemoriesLexical(args: {
  workspaceId: string
  userId: string
  query: string
  k: number
}) {
  const rows = await prisma.workspaceAgentMemory.findMany({
    where: {
      workspaceId: args.workspaceId,
      OR: [{ scope: 'WORKSPACE' }, { scope: 'USER', userId: args.userId }],
    },
    take: args.k * 4,
  })
  const q = args.query.toLowerCase()
  return rows
    .map((r) => ({ r, score: [r.key, r.content].join(' ').toLowerCase().includes(q) ? 1 : 0 }))
    .filter((x) => x.score > 0)
    .slice(0, args.k)
    .map((x) => ({ key: x.r.key, content: x.r.content, scope: x.r.scope.toLowerCase() }))
}

async function signEnginesHeaders(args: { userId: string; workspaceId: string }) {
  const crypto = await import('node:crypto')
  const ts = Math.floor(Date.now() / 1000)
  const secret = process.env.AGENTS_TO_ENGINES_SECRET ?? ''
  const sig = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${args.userId}:${args.workspaceId}:${ts}`)
    .digest('base64')
  return {
    authorization: `Bearer ${sig}`,
    'x-agents-user': args.userId,
    'x-agents-workspace': args.workspaceId,
    'x-agents-timestamp': String(ts),
  }
}
