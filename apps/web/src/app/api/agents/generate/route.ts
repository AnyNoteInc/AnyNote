import { FileStatus, prisma } from '@repo/db'
import { NextResponse, type NextRequest } from 'next/server'

import { signAgentsJwt, type AgentsRole } from '@/lib/agents-token'
import { activeStreamRegistry } from '@/lib/chat/active-stream-registry'
import { buildAgentRunPayload } from '@/lib/chat/agents-payload'
import { buildEnginesMcpHeaders } from '@/lib/chat/engines-mcp-headers'
import { buildChatHistoryMessages } from '@/lib/chat/chat-history'
import { decryptMcpHeadersMap } from '@/lib/decrypt-workspace-secrets'
import {
  createAttacmentPart,
  createEntryResponse,
  createTextPart,
  streamAgentSseToRegistry,
} from '@/lib/chat/agent-sse-bridge'
import type { StartChatGenerationBody } from '@/lib/chat/types'
import { getSession } from '@/lib/get-session'
import { resolveProviderConnection } from '@/lib/chat/provider-connection'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseBody(raw: unknown): StartChatGenerationBody {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid body')
  const body = raw as Record<string, unknown>
  if (typeof body.chatId !== 'string' || !UUID_RE.test(body.chatId))
    throw new Error('chatId must be a UUID')
  if (typeof body.text !== 'string' || body.text.trim().length === 0)
    throw new Error('text must be a non-empty string')
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter(
        (id): id is string => typeof id === 'string' && UUID_RE.test(id),
      )
    : []
  return { chatId: body.chatId, text: body.text.trim(), fileIds }
}

type ValidChatFile = { id: string; name: string; mimeType: string; fileSize: bigint }

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: StartChatGenerationBody
  try {
    body = parseBody(await request.json())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid body' },
      { status: 400 },
    )
  }

  const chat = await prisma.chat.findFirst({
    where: {
      id: body.chatId,
      workspace: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true, title: true, workspaceId: true, parentId: true },
  })
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const [files, settings, historyMessages, membership, mcpServerRows, memoryRows] =
    await Promise.all([
      body.fileIds.length > 0
        ? prisma.file.findMany({
            where: {
              id: { in: body.fileIds },
              status: FileStatus.ACTIVE,
              userId: session.user.id,
              workspaceId: chat.workspaceId,
            },
            select: { id: true, name: true, mimeType: true, fileSize: true },
          })
        : (Promise.resolve([]) as Promise<ValidChatFile[]>),
      prisma.workspaceAiSettings.findUnique({
        where: { workspaceId: chat.workspaceId },
        include: {
          defaultModel: { include: { provider: true } },
          embeddingsModel: { include: { provider: true } },
        },
      }),
      buildChatHistoryMessages({ prisma, chatId: chat.id, workspaceId: chat.workspaceId }),
      prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: chat.workspaceId, userId: session.user.id } },
        select: { role: true },
      }),
      prisma.workspaceMcpServer.findMany({
        where: { workspaceId: chat.workspaceId, enabled: true },
        select: {
          id: true,
          name: true,
          description: true,
          url: true,
          transport: true,
          headers: true,
          toolsAllowlist: true,
          verifyTls: true,
        },
      }),
      prisma.workspaceAgentMemory.findMany({
        where: {
          workspaceId: chat.workspaceId,
          OR: [
            { scope: 'WORKSPACE' },
            { scope: 'USER', userId: session.user.id },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { key: true, content: true, scope: true },
      }),
    ])

  if (files.length !== body.fileIds.length) {
    return NextResponse.json({ error: 'One or more files are invalid for this chat' }, { status: 400 })
  }
  if (!settings?.defaultModel) {
    return NextResponse.json({ error: 'Workspace AI default model is not configured' }, { status: 400 })
  }
  if (!membership) {
    return NextResponse.json({ error: 'Membership not found' }, { status: 403 })
  }

  const ts = Math.floor(Date.now() / 1000)
  const enginesMcpHeaders = buildEnginesMcpHeaders({
    userId: session.user.id,
    ts,
  })

  const enginesMcpServer = {
    name: 'anynote',
    description: 'AnyNote workspace tools',
    url: process.env.ENGINES_MCP_URL ?? 'http://localhost:8082/mcp',
    transport: 'HTTP_JSONRPC' as const,
    headers: enginesMcpHeaders,
    tools: [],
    retries: 3,
    verify: false,
    workspaceId: chat.workspaceId,
  }

  const decryptedHeadersMap = decryptMcpHeadersMap(mcpServerRows)
  const userMcpServers = mcpServerRows.map((s) => ({
    name: s.name,
    description: s.description ?? '',
    url: s.url,
    transport: s.transport as 'HTTP_JSONRPC' | 'SSE',
    headers: decryptedHeadersMap[s.id] ?? {},
    tools: s.toolsAllowlist,
    retries: 3,
    verify: s.verifyTls,
  }))

  const longTermMemories = memoryRows.map((m) => ({
    key: m.key,
    content: m.content,
    scope: m.scope.toLowerCase() as 'workspace' | 'user',
  }))

  // The agents service matches providers by ModelProviderEnum value (a Python StrEnum
  // with auto(), so lowercased member names). AiProviderKind uses the same names, so
  // kind.toLowerCase() is the wire value. Keep the two enums in sync
  // (apps/agents/agents/apps/agent/enums_shared.py).
  const settingsSnapshot = {
    defaultModel: {
      slug: settings.defaultModel.slug,
      provider: {
        kind: settings.defaultModel.provider.kind.toLowerCase(),
        connection: resolveProviderConnection(settings.defaultModel.provider),
      },
    },
    embeddingsModel:
      settings.embeddingsModel && settings.embeddingsModel.vectorSize !== null
        ? {
            slug: settings.embeddingsModel.slug,
            vectorSize: settings.embeddingsModel.vectorSize,
            provider: {
              kind: settings.embeddingsModel.provider.kind.toLowerCase(),
              connection: resolveProviderConnection(settings.embeddingsModel.provider),
            },
          }
        : null,
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
    topP: settings.topP,
  }

  const filesById = new Map(files.map((f) => [f.id, f]))
  const orderedFiles = body.fileIds.flatMap((id) => {
    const f = filesById.get(id)
    return f ? [f] : []
  })

  const { assistantMessage, userMessage } = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.chatMessage.create({
      data: {
        chatId: chat.id,
        parts: [createTextPart(body.text), ...orderedFiles.map(createAttacmentPart)],
        role: 'USER',
        status: 'DONE',
      },
    })
    const assistantMessage = await tx.chatMessage.create({
      data: { chatId: chat.id, errorMessage: null, parts: [], role: 'ASSISTANT', status: 'STREAMING' },
    })
    const shouldRename = chat.title === 'Новый чат'
    await tx.chat.update({
      where: { id: chat.id },
      data: { updatedAt: new Date(), title: shouldRename ? body.text.slice(0, 48) : undefined },
    })
    return { assistantMessage, userMessage }
  })

  const jwt = await signAgentsJwt({
    userId: session.user.id,
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    role: membership.role as AgentsRole,
  })

  const payload = buildAgentRunPayload({
    chatId: chat.id,
    userMessage: body.text,
    chatHistory: historyMessages,
    settings: settingsSnapshot,
    mcpServers: [enginesMcpServer, ...userMcpServers],
    longTermMemories,
  })

  const entry = activeStreamRegistry.create({
    assistantMessageId: assistantMessage.id,
    chatId: chat.id,
    userMessageId: userMessage.id,
  })

  const agentsUrl = process.env.AGENTS_URL ?? 'http://localhost:8080'
  const upstreamTask = streamAgentSseToRegistry({
    assistantMessageId: assistantMessage.id,
    chatId: chat.id,
    entry,
    jwt,
    upstreamUrl: `${agentsUrl}/agent/run`,
    upstreamBody: payload,
  })
  entry.setUpstreamTask(upstreamTask)

  return createEntryResponse({
    entry,
    initialEvents: [
      { type: 'message.created', assistantMessageId: assistantMessage.id, userMessageId: userMessage.id },
      { type: 'message.status', assistantMessageId: assistantMessage.id, status: 'STREAMING' },
    ],
  })
}
