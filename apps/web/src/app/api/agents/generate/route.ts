import { NextResponse, type NextRequest } from "next/server"

import { prisma } from "@repo/db"

import { getSession } from "@/lib/get-session"

export const runtime = "nodejs"

interface GenerateBody {
  workspaceId: string
  threadId: string
  prompt: string
  history: Array<{ role: "user" | "assistant"; content: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseBody(raw: unknown): GenerateBody {
  if (!raw || typeof raw !== "object") throw new Error("Invalid body")
  const o = raw as Record<string, unknown>
  if (typeof o.workspaceId !== "string" || !UUID_RE.test(o.workspaceId)) {
    throw new Error("workspaceId must be a UUID")
  }
  if (typeof o.threadId !== "string" || !UUID_RE.test(o.threadId)) {
    throw new Error("threadId must be a UUID")
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
  return { workspaceId: o.workspaceId, threadId: o.threadId, prompt: o.prompt, history }
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

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: body.workspaceId, userId: session.user.id } },
  })
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const settings = await prisma.workspaceAiSettings.findUnique({
    where: { workspaceId: body.workspaceId },
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
  const baseUrl =
    PROVIDER_BASE_URLS[providerSlug] ??
    provider.defaultBaseUrl ??
    undefined

  const systemPrompt = settings.systemPromptPage?.content
    ? extractTextFromTiptap(settings.systemPromptPage.content)
    : undefined

  const agentsPayload = {
    threadId: body.threadId,
    model: {
      provider: providerSlug,
      name: settings.defaultModel.slug,
      connection: { baseUrl },
      settings: {
        temperature: settings.temperature ?? settings.defaultModel.defaultTemperature ?? undefined,
        maxOutputTokens: settings.maxOutputTokens ?? undefined,
        topP: settings.topP ?? undefined,
      },
    },
    instructions: systemPrompt ? { systemPrompt } : undefined,
    conversation: { messages: body.history },
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

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
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
