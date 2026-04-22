import { FileStatus, prisma } from "@repo/db"
import { NextResponse, type NextRequest } from "next/server"

import { getSession } from "@/lib/get-session"
import { activeStreamRegistry } from "@/lib/chat/active-stream-registry"
import {
  buildAgentsPayload,
  type WorkspaceSettingsSnapshot,
} from "@/lib/chat/agents-payload"
import { encodeSseEvent, decodeAgentsSseEvents } from "@/lib/chat/sse"
import type {
  ServiceBlock,
  StartChatGenerationBody,
} from "@/lib/chat/types"

export const runtime = "nodejs"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseBody(raw: unknown): StartChatGenerationBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid body")
  }

  const body = raw as Record<string, unknown>
  if (typeof body.chatId !== "string" || !UUID_RE.test(body.chatId)) {
    throw new Error("chatId must be a UUID")
  }
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    throw new Error("text must be a non-empty string")
  }

  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((fileId): fileId is string => typeof fileId === "string" && UUID_RE.test(fileId))
    : []

  return {
    chatId: body.chatId,
    text: body.text.trim(),
    fileIds,
  }
}

function upsertServiceBlock(blocks: ServiceBlock[], block: ServiceBlock): ServiceBlock[] {
  const next = [...blocks]
  const existingIndex = next.findIndex((candidate) => candidate.id === block.id)
  if (existingIndex >= 0) {
    next[existingIndex] = block
    return next
  }
  next.push(block)
  return next
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
        content: args.entry.content,
        errorMessage: args.entry.errorMessage ?? null,
        status: args.entry.status,
      },
    })
  }

  return {
    schedule() {
      if (timer) {
        return
      }
      timer = setTimeout(() => {
        timer = null
        void persist()
      }, 200)
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
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
          if (event.type === "message.done") {
            unsubscribe()
            controller.close()
          }
        })

        return () => unsubscribe()
      },
    }),
    {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      },
    },
  )
}

async function streamAgentsToRegistry(args: {
  assistantMessageId: string
  chatId: string
  entry: ReturnType<typeof activeStreamRegistry.create>
  text: string
  userId: string
  workspaceId: string
  settings: WorkspaceSettingsSnapshot
}) {
  const flush = createDebouncedPersist({
    assistantMessageId: args.assistantMessageId,
    entry: args.entry,
  })

  try {
    const upstream = await fetch(`${process.env.AGENTS_SERVICE_URL ?? "http://localhost:8080"}/chat/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": args.userId,
        "x-workspace-id": args.workspaceId,
      },
      body: JSON.stringify(
        buildAgentsPayload({
          chatId: args.chatId,
          settings: args.settings,
          text: args.text,
          userId: args.userId,
          workspaceId: args.workspaceId,
        }),
      ),
    })

    if (!upstream.ok || !upstream.body) {
      const message = `Agents upstream ${upstream.status}`
      args.entry.publishStatus("ERROR", message)
      return
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let completed = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      const decoded = decoder.decode(value, { stream: true })
      const parsed = decodeAgentsSseEvents({ buffer, chunk: decoded })
      buffer = parsed.buffer

      for (const event of parsed.events) {
        if (event.type === "token") {
          args.entry.publishDelta(event.text)
          flush.schedule()
          continue
        }

        if (event.type === "status") {
          args.entry.publishBlocks(
            upsertServiceBlock(args.entry.blocks, {
              id: event.id,
              kind: event.kind,
              state: event.state,
              title: event.title,
              detail: event.detail,
            }),
          )
          continue
        }

        if (event.type === "error") {
          args.entry.publishStatus("ERROR", event.message)
          completed = true
          break
        }

        if (event.type === "done") {
          args.entry.publishStatus("DONE")
          completed = true
        }
      }
    }

    if (!completed) {
      args.entry.publishStatus("DONE")
    }
  } catch (error) {
    args.entry.publishStatus(
      "ERROR",
      error instanceof Error ? error.message : "Agents upstream failed",
    )
  } finally {
    await flush.flush()
    args.entry.publishDone()
    args.entry.scheduleCleanup()
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: StartChatGenerationBody
  try {
    body = parseBody(await request.json())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid body" },
      { status: 400 },
    )
  }

  const chat = await prisma.chat.findFirst({
    where: {
      id: body.chatId,
      workspace: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true, title: true, workspaceId: true },
  })
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 })
  }

  if (body.fileIds.length > 0) {
    const files = await prisma.file.findMany({
      where: {
        id: { in: body.fileIds },
        status: FileStatus.ACTIVE,
        userId: session.user.id,
        workspaceId: chat.workspaceId,
      },
      select: { id: true },
    })
    if (files.length !== body.fileIds.length) {
      return NextResponse.json({ error: "One or more files are invalid for this chat" }, { status: 400 })
    }
  }

  const settings = await prisma.workspaceAiSettings.findUnique({
    where: { workspaceId: chat.workspaceId },
    include: {
      defaultModel: { include: { provider: true } },
    },
  })
  if (!settings?.defaultModel) {
    return NextResponse.json(
      { error: "Workspace AI default model is not configured" },
      { status: 400 },
    )
  }

  const settingsSnapshot: WorkspaceSettingsSnapshot = {
    defaultModel: {
      slug: settings.defaultModel.slug,
      provider: {
        slug: settings.defaultModel.provider.slug,
        connection: settings.defaultModel.provider.connection,
      },
    },
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
    topP: settings.topP,
  }

  const { assistantMessage, userMessage } = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.chatMessage.create({
      data: {
        chatId: chat.id,
        content: body.text,
        role: "USER",
        status: "DONE",
      },
    })

    if (body.fileIds.length > 0) {
      await tx.chatMessageFile.createMany({
        data: body.fileIds.map((fileId) => ({
          fileId,
          messageId: userMessage.id,
        })),
        skipDuplicates: true,
      })
    }

    const assistantMessage = await tx.chatMessage.create({
      data: {
        chatId: chat.id,
        content: "",
        errorMessage: null,
        role: "ASSISTANT",
        status: "STREAMING",
      },
    })

    const shouldRename = chat.title === "Новый чат"
    await tx.chat.update({
      where: { id: chat.id },
      data: {
        updatedAt: new Date(),
        title: shouldRename ? body.text.slice(0, 48) : undefined,
      },
    })

    return { assistantMessage, userMessage }
  })

  const entry = activeStreamRegistry.create({
    assistantMessageId: assistantMessage.id,
    chatId: chat.id,
    userMessageId: userMessage.id,
  })

  const upstreamTask = streamAgentsToRegistry({
    assistantMessageId: assistantMessage.id,
    chatId: chat.id,
    entry,
    settings: settingsSnapshot,
    text: body.text,
    userId: session.user.id,
    workspaceId: chat.workspaceId,
  })
  entry.setUpstreamTask(upstreamTask)

  return createEntryResponse({
    entry,
    initialEvents: [
      {
        type: "message.created",
        assistantMessageId: assistantMessage.id,
        userMessageId: userMessage.id,
      },
      {
        type: "message.status",
        assistantMessageId: assistantMessage.id,
        status: "STREAMING",
      },
    ],
  })
}
