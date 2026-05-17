import { FileStatus, prisma } from '@repo/db'
import { NextResponse, type NextRequest } from 'next/server'

import { signAgentsJwt, type AgentsRole } from '@/lib/agents-token'
import { activeStreamRegistry } from '@/lib/chat/active-stream-registry'
import { buildAgentRunPayload } from '@/lib/chat/agents-payload'
import { buildEnginesMcpHeaders } from '@/lib/chat/engines-mcp-headers'
import { buildChatHistoryMessages } from '@/lib/chat/chat-history'
import { encodeSseEvent } from '@/lib/chat/sse'
import { decryptMcpHeadersMap } from '@/lib/decrypt-workspace-secrets'
import type { ServiceBlock, StartChatGenerationBody } from '@/lib/chat/types'
import { getSession } from '@/lib/get-session'

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

function upsertServiceBlock(blocks: ServiceBlock[], block: ServiceBlock): ServiceBlock[] {
  const next = [...blocks]
  const idx = next.findIndex((b) => b.id === block.id)
  if (idx >= 0) { next[idx] = block; return next }
  next.push(block)
  return next
}

type ValidChatFile = { id: string; name: string; mimeType: string; fileSize: bigint }

function createTextPart(text: string) { return { type: 'text' as const, text } }
function createAttacmentPart(file: ValidChatFile) {
  return {
    type: 'attacment' as const,
    fileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    fileSize: file.fileSize.toString(),
  }
}
function createToolPart(block: ServiceBlock) { return { type: 'tool' as const, ...block } }
function createAssistantParts(entry: ReturnType<typeof activeStreamRegistry.create>) {
  return [
    ...(entry.content.length > 0 ? [createTextPart(entry.content)] : []),
    ...entry.blocks.map(createToolPart),
  ]
}

function createDebouncedPersist(args: {
  assistantMessageId: string
  entry: ReturnType<typeof activeStreamRegistry.create>
}) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const persist = async () => {
    await prisma.chatMessage.update({
      where: { id: args.assistantMessageId },
      data: {
        errorMessage: args.entry.errorMessage ?? null,
        parts: createAssistantParts(args.entry),
        status: args.entry.status,
      },
    })
  }
  return {
    schedule() {
      if (timer) return
      timer = setTimeout(() => { timer = null; void persist() }, 200)
    },
    async flush() {
      if (timer) { clearTimeout(timer); timer = null }
      await persist()
    },
  }
}

function createEntryResponse(args: {
  entry: ReturnType<typeof activeStreamRegistry.create>
  initialEvents: Array<Parameters<typeof encodeSseEvent>[0]>
}) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of args.initialEvents) {
          controller.enqueue(encodeSseEvent(event))
        }
        let unsubscribe = () => {}
        unsubscribe = args.entry.subscribe((event) => {
          controller.enqueue(encodeSseEvent(event))
          if (event.type === 'message.done') { unsubscribe(); controller.close() }
        })
        return () => unsubscribe()
      },
    }),
    {
      headers: {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
      },
    },
  )
}

// Shape of events emitted by /agent/run
type AgentRunSseEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_status'; id: string; tool: string; state: 'running' | 'done' | 'error'; title: string; detail?: string }
  | { type: 'plan_step'; id: string; title: string; position: number; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' }
  | { type: 'step_started'; step_id: string }
  | { type: 'step_completed'; step_id: string; result_summary: string }
  | { type: 'confirmation_required'; confirmation_id: string; tool: string; summary: string; args_preview: unknown }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' }
  | { type: 'router_decision' | 'memory_write_proposed' | 'critic_verdict' | 'citation' | 'usage' }

function mapPlanStepStatus(s: string): ServiceBlock['state'] {
  if (s === 'running') return 'running'
  if (s === 'done') return 'done'
  if (s === 'failed') return 'error'
  return 'pending'
}

function decodeSseEvents(args: { buffer: string; chunk: string }): { buffer: string; events: AgentRunSseEvent[] } {
  const combined = args.buffer + args.chunk
  const frames = combined.split(/\r?\n\r?\n/)
  const trailing = frames.pop() ?? ''
  const events: AgentRunSseEvent[] = []
  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data) continue
    try {
      const parsed = JSON.parse(data) as AgentRunSseEvent
      if (parsed && typeof parsed === 'object' && 'type' in parsed) events.push(parsed)
    } catch { continue }
  }
  return { buffer: trailing, events }
}

async function streamAgentRunToRegistry(args: {
  assistantMessageId: string
  chatId: string
  entry: ReturnType<typeof activeStreamRegistry.create>
  jwt: string
  payload: ReturnType<typeof buildAgentRunPayload>
}) {
  const flush = createDebouncedPersist({ assistantMessageId: args.assistantMessageId, entry: args.entry })

  try {
    const agentsUrl = process.env.AGENTS_URL ?? 'http://localhost:8080'
    const upstream = await fetch(`${agentsUrl}/agent/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.jwt}`,
      },
      body: JSON.stringify(args.payload),
    })

    if (!upstream.ok || !upstream.body) {
      args.entry.publishStatus('ERROR', `Agents upstream ${upstream.status}`)
      return
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      const parsed = decodeSseEvents({ buffer, chunk })
      buffer = parsed.buffer

      for (const event of parsed.events) {
        if (event.type === 'token') {
          args.entry.publishDelta(event.text)
          flush.schedule()
          continue
        }

        if (event.type === 'tool_status') {
          args.entry.publishBlocks(
            upsertServiceBlock(args.entry.blocks, {
              id: event.id,
              kind: 'tool',
              state: event.state,
              title: event.title,
              detail: event.detail,
            }),
          )
          flush.schedule()
          continue
        }

        if (event.type === 'plan_step') {
          args.entry.publishBlocks(
            upsertServiceBlock(args.entry.blocks, {
              id: `plan-${event.id}`,
              kind: 'tool',
              state: mapPlanStepStatus(event.status),
              title: event.title,
            }),
          )
          continue
        }

        if (event.type === 'step_started') {
          const planBlockId = `plan-${event.step_id}`
          const existing = args.entry.blocks.find((b) => b.id === planBlockId)
          if (existing) {
            args.entry.publishBlocks(
              upsertServiceBlock(args.entry.blocks, { ...existing, state: 'running' }),
            )
          }
          continue
        }

        if (event.type === 'step_completed') {
          const planBlockId = `plan-${event.step_id}`
          const existing = args.entry.blocks.find((b) => b.id === planBlockId)
          if (existing) {
            args.entry.publishBlocks(
              upsertServiceBlock(args.entry.blocks, {
                ...existing,
                state: 'done',
                result: event.result_summary,
              }),
            )
          }
          continue
        }

        if (event.type === 'confirmation_required') {
          args.entry.publishBlocks(
            upsertServiceBlock(args.entry.blocks, {
              id: event.confirmation_id,
              kind: 'confirmation',
              state: 'required',
              title: event.summary,
              detail: JSON.stringify({ confirmation_id: event.confirmation_id, tool: event.tool }),
            }),
          )
          continue
        }

        if (event.type === 'error') {
          args.entry.publishStatus('ERROR', event.message)
          completed = true
          break
        }

        if (event.type === 'done') {
          args.entry.publishStatus('DONE')
          completed = true
          break
        }

        // router_decision, memory_write_proposed, critic_verdict, citation, usage — no-op
      }

      if (completed) break
    }

    if (!completed) args.entry.publishStatus('DONE')
  } catch (error) {
    args.entry.publishStatus('ERROR', error instanceof Error ? error.message : 'Agents upstream failed')
  } finally {
    await flush.flush()
    args.entry.publishDone()
    args.entry.scheduleCleanup()
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
    workspaceId: chat.workspaceId,
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

  const settingsSnapshot = {
    defaultModel: {
      slug: settings.defaultModel.slug,
      provider: {
        slug: settings.defaultModel.provider.slug,
        connection: settings.defaultModel.provider.connection,
      },
    },
    embeddingsModel:
      settings.embeddingsModel && settings.embeddingsModel.vectorSize !== null
        ? {
            slug: settings.embeddingsModel.slug,
            vectorSize: settings.embeddingsModel.vectorSize,
            provider: {
              slug: settings.embeddingsModel.provider.slug,
              connection: settings.embeddingsModel.provider.connection,
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

  const upstreamTask = streamAgentRunToRegistry({
    assistantMessageId: assistantMessage.id,
    chatId: chat.id,
    entry,
    jwt,
    payload,
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
