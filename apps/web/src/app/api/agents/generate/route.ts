import { NextResponse, type NextRequest } from "next/server"

import { prisma } from "@repo/db"

import { getSession } from "@/lib/get-session"

export const runtime = "nodejs"

interface GenerateBody {
  chatId: string
  prompt: string
  history: Array<{ role: "user" | "assistant"; content: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseBody(raw: unknown): GenerateBody {
  if (!raw || typeof raw !== "object") throw new Error("Invalid body")
  const o = raw as Record<string, unknown>
  if (typeof o.chatId !== "string" || !UUID_RE.test(o.chatId)) {
    throw new Error("chatId must be a UUID")
  }
  if (typeof o.prompt !== "string" || o.prompt.length === 0) {
    throw new Error("prompt must be a non-empty string")
  }
  const historyRaw = Array.isArray(o.history) ? o.history : []
  const history: GenerateBody["history"] = []
  for (const item of historyRaw) {
    if (!item || typeof item !== "object") continue
    const m = item as Record<string, unknown>
    if ((m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
      history.push({ role: m.role, content: m.content })
    }
  }
  return { chatId: o.chatId, prompt: o.prompt, history }
}

function providerConnection(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v
  }
  return out
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  let body: GenerateBody
  try {
    body = parseBody(await req.json())
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid body" },
      { status: 400 },
    )
  }

  const chat = await prisma.chat.findFirst({
    where: {
      id: body.chatId,
      workspace: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true, workspaceId: true, title: true },
  })
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 })
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

  const provider = settings.defaultModel.provider
  const connection = providerConnection(provider.connection)

  // Persist user message + bump chat title (if still default) BEFORE streaming
  // so the row is durable even if the upstream call fails.
  await prisma.$transaction(async (tx) => {
    await tx.chatMessage.create({
      data: { chatId: chat.id, role: "USER", content: body.prompt },
    })
    const shouldRename = chat.title === "Новый чат"
    await tx.chat.update({
      where: { id: chat.id },
      data: {
        updatedAt: new Date(),
        title: shouldRename ? body.prompt.slice(0, 48) : undefined,
      },
    })
  })

  const agentsPayload = {
    threadId: chat.id,
    model: {
      provider: provider.slug,
      name: settings.defaultModel.slug,
      connection,
      settings: {
        temperature: settings.temperature,
        topP: settings.topP,
      },
    },
    instructions: settings.systemPrompt ? { systemPrompt: settings.systemPrompt } : undefined,
    conversation: { messages: body.history },
    mcp: buildMcpConfig(),
    userRequest: { text: body.prompt },
  }

  const agentsUrl = process.env.AGENTS_SERVICE_URL ?? "http://localhost:8080"
  const agentsToken = process.env.AGENTS_SERVICE_TOKEN
  if (!agentsToken) {
    return NextResponse.json({ error: "AGENTS_SERVICE_TOKEN not set" }, { status: 500 })
  }

  const upstream = await fetch(`${agentsUrl}/api/v1/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${agentsToken}`,
    },
    body: JSON.stringify(agentsPayload),
  })

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "")
    return NextResponse.json(
      { error: `Agents upstream ${upstream.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    )
  }

  // Tee the upstream SSE: forward to the client AND parse to accumulate the
  // assistant's full text so we can persist it once "done" arrives.
  const decoder = new TextDecoder()
  let assistantBuffer = ""
  let finished = false

  const upstreamReader = upstream.body.getReader()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let frameBuffer = ""
      try {
        while (true) {
          const { value, done } = await upstreamReader.read()
          if (done) break
          if (value) controller.enqueue(value)
          frameBuffer += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = frameBuffer.indexOf("\n\n")) >= 0) {
            const frame = frameBuffer.slice(0, nl)
            frameBuffer = frameBuffer.slice(nl + 2)
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"))
            if (!dataLine) continue
            const json = dataLine.slice(5).trim()
            if (!json) continue
            try {
              const ev: { type: string; content?: string } = JSON.parse(json)
              if (ev.type === "token" && typeof ev.content === "string") {
                assistantBuffer += ev.content
              } else if (ev.type === "done") {
                finished = true
              }
            } catch {
              // Non-JSON SSE frame; forward but skip persistence accounting.
            }
          }
        }
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
        if (finished && assistantBuffer.trim().length > 0) {
          try {
            await prisma.chatMessage.create({
              data: { chatId: chat.id, role: "ASSISTANT", content: assistantBuffer },
            })
            await prisma.chat.update({
              where: { id: chat.id },
              data: { updatedAt: new Date() },
            })
          } catch (persistErr) {
            // Logging only — the stream already completed for the client.
            console.error("[chat-persist] failed to save assistant message", persistErr)
          }
        }
      }
    },
    cancel() {
      void upstreamReader.cancel()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}

function buildMcpConfig(): { servers: Array<{ name: string; description: string; url: string; authHeader?: string }> } | undefined {
  const enginesUrl = process.env.ENGINES_MCP_URL
  const enginesToken = process.env.ENGINES_MCP_TOKEN
  if (!enginesUrl) return undefined
  return {
    servers: [
      {
        name: "anynote-engines",
        description: "Workspace tools: page search and lookup",
        url: enginesUrl,
        authHeader: enginesToken ? `Bearer ${enginesToken}` : undefined,
      },
    ],
  }
}
