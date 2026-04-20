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

const PROVIDER_BASE_URLS: Record<string, string> = {
  ollama: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
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
      systemPromptPage: { select: { content: true, title: true } },
    },
  })
  if (!settings?.defaultModel) {
    return NextResponse.json(
      { error: "Workspace AI default model is not configured" },
      { status: 400 },
    )
  }

  const provider = settings.defaultModel.provider
  const providerSlug = provider.slug
  const credentialsByProvider =
    settings.providerCredentials &&
    typeof settings.providerCredentials === "object" &&
    !Array.isArray(settings.providerCredentials)
      ? (settings.providerCredentials as Record<string, Record<string, string>>)
      : {}
  const providerCreds = credentialsByProvider[providerSlug] ?? {}
  const baseUrl =
    providerCreds.baseUrl ?? PROVIDER_BASE_URLS[providerSlug] ?? provider.defaultBaseUrl ?? undefined

  const systemPrompt = settings.systemPromptPage?.content
    ? extractTextFromTiptap(settings.systemPromptPage.content)
    : undefined

  const skillPages =
    settings.skillPageIds.length > 0
      ? await prisma.page.findMany({
          where: { id: { in: settings.skillPageIds }, workspaceId: chat.workspaceId },
          select: { id: true, title: true, content: true },
        })
      : []
  const skills = skillPages.map((p) => ({
    id: p.id,
    title: p.title ?? "Skill",
    markdown: p.content ? extractTextFromTiptap(p.content) : "",
  }))

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
      provider: providerSlug,
      name: settings.defaultModel.slug,
      connection: {
        baseUrl,
        apiKey: providerCreds.apiKey ?? undefined,
        organization: providerCreds.organization ?? undefined,
        clientId: providerCreds.clientId ?? undefined,
        clientSecret: providerCreds.clientSecret ?? undefined,
        scope: providerCreds.scope ?? undefined,
      },
      settings: {
        temperature: settings.temperature ?? settings.defaultModel.defaultTemperature ?? undefined,
        maxOutputTokens: settings.maxOutputTokens ?? undefined,
        topP: settings.topP ?? undefined,
      },
    },
    instructions: systemPrompt ? { systemPrompt } : undefined,
    conversation: { messages: body.history },
    skills,
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

function extractTextFromTiptap(content: unknown): string {
  if (!content) return ""
  const parts: string[] = []
  walk(content as { type?: string; text?: string; content?: unknown[] }, parts)
  return parts.join("").trim()
}

function walk(
  node: { type?: string; text?: string; content?: unknown[] },
  parts: string[],
): void {
  if (!node || typeof node !== "object") return
  if (node.type === "text" && typeof node.text === "string") {
    parts.push(node.text)
    return
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walk(child as { type?: string; text?: string; content?: unknown[] }, parts)
    }
  }
  if (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "blockquote" ||
    node.type === "listItem" ||
    node.type === "codeBlock"
  ) {
    parts.push("\n\n")
  }
}
