import { FileStatus, prisma, type Chat } from '@repo/db'
import { storage } from '@repo/storage'
import { buildPageVisibilityWhere, getWorkspaceFeatures } from '@repo/trpc'
import { NextResponse, type NextRequest } from 'next/server'

import { getMembershipForToken, signAgentsJwt } from '@/lib/agents-token'
import { activeStreamRegistry } from '@/lib/chat/active-stream-registry'
import { buildAgentRunPayload } from '@/lib/chat/agents-payload'
import { buildEnginesMcpHeaders } from '@/lib/chat/engines-mcp-headers'
import { buildChatHistoryMessages } from '@/lib/chat/chat-history'
import { resolveAttachmentContents, type ResolvedAttachment } from '@/lib/chat/file-content'
import {
  buildPageBindingPrompt,
  buildPageContextAttachment,
  parsePageContext,
  type PageContextInput,
} from '@/lib/chat/page-context'
import { decryptMcpHeadersMap } from '@/lib/decrypt-workspace-secrets'
import {
  createAttacmentPart,
  createEntryResponse,
  createTextPart,
  streamAgentSseToRegistry,
} from '@/lib/chat/agent-sse-bridge'
import type { StartChatGenerationBody } from '@/lib/chat/types'
import { getSession } from '@/lib/get-session'
import { UUID_RE } from '@/lib/uuid'
import { resolveProviderConnection } from '@/lib/chat/provider-connection'

export const runtime = 'nodejs'

const THINKING_EFFORTS = ['LOW', 'MEDIUM', 'HIGH'] as const
type ThinkingEffort = (typeof THINKING_EFFORTS)[number]

const REASONING_EFFORT_BY_THINKING: Record<ThinkingEffort, 'low' | 'medium' | 'high'> = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
}

function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === 'string' && (THINKING_EFFORTS as readonly string[]).includes(value)
}

function parseBody(raw: unknown): StartChatGenerationBody {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid body')
  const body = raw as Record<string, unknown>
  if (typeof body.chatId !== 'string' || !UUID_RE.test(body.chatId))
    throw new Error('chatId must be a UUID')
  if (typeof body.text !== 'string' || body.text.trim().length === 0)
    throw new Error('text must be a non-empty string')
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    : []
  const pageContext = parsePageContext(body.pageContext)
  if (pageContext && 'error' in pageContext) throw new Error(pageContext.error)
  return {
    chatId: body.chatId,
    text: body.text.trim(),
    fileIds,
    ...(typeof body.useThinking === 'boolean' ? { useThinking: body.useThinking } : {}),
    ...(isThinkingEffort(body.thinkingEffort) ? { thinkingEffort: body.thinkingEffort } : {}),
    ...(pageContext ? { pageContext } : {}),
  }
}

type ValidChatFile = {
  id: string
  name: string
  ext: string
  mimeType: string
  fileSize: bigint
  path: string
}

/**
 * PAGE-chat gates: plan gate (server authority, spec §8.2) + page-visibility
 * gate. Spec §6.2 lists generate among the visibility-gated consumers: even
 * without a pageContext body, streaming into a page chat requires the caller
 * to still see the page — its history already carries injected page content.
 * Fails closed on orphans (page delete SetNull'd pageId) with the same
 * uniform 404. Returns the rejection response, or the context attachment to
 * inject (null unless the body carried a pageContext).
 */
async function gatePageChat(
  chat: Pick<Chat, 'kind' | 'pageId' | 'workspaceId'>,
  userId: string,
  pageContext: PageContextInput | undefined,
): Promise<
  | NextResponse
  | { attachment: ResolvedAttachment | null; page: { id: string; title: string | null } | null }
> {
  // pageContext is a PAGE-chat-only channel — reject it outright on NORMAL chats.
  if (pageContext && chat.kind !== 'PAGE') {
    return NextResponse.json(
      { error: 'pageContext is only allowed for page chats' },
      { status: 400 },
    )
  }
  if (chat.kind !== 'PAGE') return { attachment: null, page: null }

  const features = await getWorkspaceFeatures(chat.workspaceId)
  if (!features.chatsEnabled) {
    return NextResponse.json(
      { error: 'Чаты недоступны на вашем тарифе', code: 'PLAN' },
      { status: 403 },
    )
  }
  if (!chat.pageId) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  const contextPage = await prisma.page.findFirst({
    where: {
      id: chat.pageId,
      workspaceId: chat.workspaceId,
      deletedAt: null,
      AND: [buildPageVisibilityWhere(userId)],
    },
    select: { id: true, title: true },
  })
  if (!contextPage) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  return {
    attachment: pageContext
      ? buildPageContextAttachment(pageContext, contextPage.title ?? '')
      : null,
    page: contextPage,
  }
}

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
      // Blocked users get the same uniform 404 as non-members — and we skip
      // the parallel context fan-out below entirely.
      workspace: {
        members: { some: { userId: session.user.id } },
        blockedUsers: { none: { userId: session.user.id } },
      },
    },
    select: {
      id: true,
      title: true,
      workspaceId: true,
      parentId: true,
      useThinking: true,
      thinkingEffort: true,
      kind: true,
      pageId: true,
    },
  })
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const gate = await gatePageChat(chat, session.user.id, body.pageContext)
  if (gate instanceof NextResponse) return gate
  const pageContextAttachment = gate.attachment
  const boundPage = gate.page

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
            select: {
              id: true,
              name: true,
              ext: true,
              mimeType: true,
              fileSize: true,
              path: true,
            },
          })
        : (Promise.resolve([]) as Promise<ValidChatFile[]>),
      prisma.workspaceAiSettings.findUnique({
        where: { workspaceId: chat.workspaceId },
        include: {
          defaultModel: { include: { provider: true } },
          embeddingsModel: { include: { provider: true } },
        },
      }),
      buildChatHistoryMessages({
        prisma,
        chatId: chat.id,
        workspaceId: chat.workspaceId,
        // «Вся история» for page chats (spec §5): the whole thread rides along
        // with every page-context send instead of the last-10 window.
        fullCurrentChat: chat.kind === 'PAGE',
      }),
      // Active members only — blocked users get no membership, hence no scopes.
      getMembershipForToken(prisma, chat.workspaceId, session.user.id),
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
          OR: [{ scope: 'WORKSPACE' }, { scope: 'USER', userId: session.user.id }],
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { key: true, content: true, scope: true },
      }),
    ])

  if (files.length !== body.fileIds.length) {
    return NextResponse.json(
      { error: 'One or more files are invalid for this chat' },
      { status: 400 },
    )
  }
  if (!settings?.defaultModel) {
    return NextResponse.json(
      { error: 'Workspace AI default model is not configured' },
      { status: 400 },
    )
  }
  if (!membership) {
    return NextResponse.json({ error: 'Membership not found' }, { status: 403 })
  }

  const ts = Math.floor(Date.now() / 1000)
  // PAGE chats are HARD-bound to their page: the bound id rides the HMAC-signed
  // engines headers (engines rejects writes to any other page) and the agents
  // JWT `pid` claim below (tool_runner denies them before they reach engines).
  const enginesMcpHeaders = buildEnginesMcpHeaders({
    userId: session.user.id,
    ts,
    boundPageId: boundPage?.id ?? null,
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
    transport: s.transport,
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
    systemPrompt: boundPage
      ? [settings.systemPrompt, buildPageBindingPrompt(boundPage, chat.workspaceId)]
          .filter(Boolean)
          .join('\n\n')
      : settings.systemPrompt,
    temperature: settings.temperature,
    topP: settings.topP,
  }

  const filesById = new Map(files.map((f) => [f.id, f]))
  const orderedFiles = body.fileIds.flatMap((id) => {
    const f = filesById.get(id)
    return f ? [f] : []
  })

  const resolvedAttachments = await resolveAttachmentContents(storage, orderedFiles)

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
      data: {
        chatId: chat.id,
        errorMessage: null,
        parts: [],
        role: 'ASSISTANT',
        status: 'STREAMING',
      },
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
    role: membership.role,
    boundPageId: boundPage?.id ?? null,
  })

  // Per-request thinking flags (from the composer) take precedence over the
  // chat row's persisted settings; the row is the fallback when the body omits
  // them. effort is wired regardless of enabled so the model gets a budget hint.
  const reasoningEnabled = body.useThinking ?? chat.useThinking
  const reasoningEffort = REASONING_EFFORT_BY_THINKING[body.thinkingEffort ?? chat.thinkingEffort]

  const payload = buildAgentRunPayload({
    chatId: chat.id,
    userMessage: body.text,
    chatHistory: historyMessages,
    settings: settingsSnapshot,
    mcpServers: [enginesMcpServer, ...userMcpServers],
    longTermMemories,
    attachments: [
      ...(pageContextAttachment ? [pageContextAttachment] : []),
      ...resolvedAttachments,
    ],
    reasoning: { enabled: reasoningEnabled, effort: reasoningEffort },
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
      {
        type: 'message.created',
        assistantMessageId: assistantMessage.id,
        userMessageId: userMessage.id,
      },
      { type: 'message.status', assistantMessageId: assistantMessage.id, status: 'STREAMING' },
    ],
  })
}
