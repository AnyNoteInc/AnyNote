import { prisma as defaultPrisma, type PrismaClient } from '@repo/db'
import { getWorkspaceFeatures } from '@repo/trpc'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { signAgentsJwt, type AgentsRole } from '@/lib/agents-token'
import { buildAgentRunPayload } from '@/lib/chat/agents-payload'
import { resolveProviderConnection } from '@/lib/chat/provider-connection'
import { decodeSseEvents } from '@/lib/chat/sse'
import { getSession } from '@/lib/get-session'
import { writeInlineAiAudit } from '@/lib/ai/inline-audit'
import { getOrCreateInlineAiChat } from '@/lib/ai/inline-chat'
import {
  buildCustomPrompt,
  buildGeneratePrompt,
  buildInlinePrompt,
  isExtendedInlineAiAction,
  isInlineAiAction,
  MAX_CONTEXT_BEFORE_CHARS,
  MAX_CUSTOM_INSTRUCTION_CHARS,
  MAX_HISTORY_TOTAL_CHARS,
  MAX_HISTORY_TURN_CHARS,
  MAX_HISTORY_TURNS,
  MAX_INSTRUCTION_CHARS,
} from '@/lib/ai/inline-prompts'
import { isInlineAiRateLimited } from '@/lib/ai/inline-rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const historyTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(MAX_HISTORY_TURN_CHARS),
})

const bodySchema = z
  .object({
    action: z.string().min(1).max(32),
    // Required for presets and `custom`; absent for `generate` (validated below).
    selectedText: z.string().min(1).max(50_000).optional(),
    instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS).optional(),
    history: z.array(historyTurnSchema).max(MAX_HISTORY_TURNS).optional(),
    // 2x slack over the prompt-side cap: the builder tail-slices to
    // MAX_CONTEXT_BEFORE_CHARS; tolerate client-side cap mismatches.
    contextBefore: z
      .string()
      .max(MAX_CONTEXT_BEFORE_CHARS * 2)
      .optional(),
    pageId: z.string().regex(UUID_RE),
    workspaceId: z.string().regex(UUID_RE),
    targetLang: z.string().max(64).optional(),
  })
  .superRefine((val, ctx) => {
    const total = (val.history ?? []).reduce((n, t) => n + t.content.length, 0)
    if (total > MAX_HISTORY_TOTAL_CHARS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'history too large' })
    }
  })

const EDIT_ROLES = new Set(['OWNER', 'ADMIN', 'EDITOR'])

/**
 * The minimal session the handler consumes — just the actor id. Narrowing the
 * dependency to what's used (not the full better-auth `Session`) keeps the
 * injected test fake honest without reconstructing the whole session object.
 */
type InlineAiSession = { user: { id: string } } | null

/**
 * Injectable dependencies — `route.ts` calls `handleInlineAi(req)` with the real
 * implementations; tests pass fakes (no live agents server, no DB). Mirrors the
 * bookmark/preview testable-handler split + injectable fetch.
 */
export type InlineAiDeps = {
  getSession: () => Promise<InlineAiSession>
  prisma: Pick<
    PrismaClient,
    | 'page'
    | 'workspaceMember'
    | 'workspaceBlockedUser'
    | 'workspaceAiSettings'
    | 'chat'
    | 'workspaceAuditLog'
  >
  getFeatures: (workspaceId: string) => Promise<{ aiSettingsEnabled: boolean }>
  signJwt: typeof signAgentsJwt
  upstreamFetch: typeof fetch
}

const defaultDeps: InlineAiDeps = {
  getSession,
  prisma: defaultPrisma,
  getFeatures: getWorkspaceFeatures,
  signJwt: signAgentsJwt,
  upstreamFetch: fetch,
}

type UpstreamUsage = {
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
}

/**
 * Token-usage carried by a `usage` SSE event, when the provider emits one.
 * The agents `usage` event is not emitted today (spec §6), so this is
 * forward-compatible: it accepts both the agents wire shape (snake_case
 * `prompt_tokens`) and the camelCase used internally, picking whichever is
 * present. When agents starts emitting usage, this captures it with no further
 * change here.
 */
function readUsage(event: { type: string } & Record<string, unknown>): UpstreamUsage | null {
  if (event.type !== 'usage') return null
  const num = (...vs: unknown[]): number | null => {
    for (const v of vs) if (typeof v === 'number') return v
    return null
  }
  return {
    promptTokens: num(event.promptTokens, event.prompt_tokens),
    completionTokens: num(event.completionTokens, event.completion_tokens),
    totalTokens: num(event.totalTokens, event.total_tokens),
  }
}

export async function handleInlineAi(
  req: Request,
  deps: InlineAiDeps = defaultDeps,
): Promise<Response> {
  // 1. Session (401) — auth first, always.
  const session = await deps.getSession()
  if (!session)
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  const userId = session.user.id

  // 2. Validate the body (zod). 400 on malformed input.
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', code: 'BAD_REQUEST' }, { status: 400 })
  }
  const {
    action,
    selectedText,
    instruction,
    history,
    contextBefore,
    pageId,
    workspaceId,
    targetLang,
  } = parsed.data

  // 3. Action allow-list (400) — the preset/action authority lives server-side.
  const isPreset = isInlineAiAction(action)
  if (!isPreset && !isExtendedInlineAiAction(action)) {
    return NextResponse.json({ error: 'Unknown action', code: 'BAD_ACTION' }, { status: 400 })
  }
  // Per-action required fields (spec §4): presets/custom transform a selection;
  // generate drafts from an instruction alone.
  if ((isPreset || action === 'custom') && !selectedText) {
    return NextResponse.json({ error: 'Invalid request', code: 'BAD_REQUEST' }, { status: 400 })
  }
  if ((action === 'custom' || action === 'generate') && !instruction) {
    return NextResponse.json({ error: 'Invalid request', code: 'BAD_REQUEST' }, { status: 400 })
  }
  if (action === 'custom' && (instruction?.length ?? 0) > MAX_CUSTOM_INSTRUCTION_CHARS) {
    return NextResponse.json({ error: 'Invalid request', code: 'BAD_REQUEST' }, { status: 400 })
  }

  // 4. Page edit-access (404, no oracle): member of a workspace the user isn't
  //    blocked in, page not trashed, and the caller can edit (creator / OWNER /
  //    ADMIN / EDITOR). Any failure → uniform 404.
  const editable = await assertPageEditable(deps.prisma, { userId, workspaceId, pageId })
  if (!editable)
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })

  // 5. Plan gate (403): inline AI rides the existing aiSettingsEnabled flag.
  const features = await deps.getFeatures(workspaceId)
  if (!features.aiSettingsEnabled) {
    return NextResponse.json(
      { error: 'AI is not available on this plan', code: 'PLAN' },
      { status: 403 },
    )
  }

  // 6. Rate limit (429), per-(user, workspace). Auth-first-then-limit ordering.
  if (isInlineAiRateLimited({ userId, workspaceId })) {
    return NextResponse.json(
      { error: 'Слишком много запросов', code: 'RATE_LIMIT' },
      { status: 429 },
    )
  }

  // 7. Provider resolution — the готовности guarantee. Load the workspace's own
  //    default model; 400 if unset; NEVER substitute a global/built-in default.
  //    (Resolution copied verbatim from api/agents/generate/route.ts.)
  const settings = await deps.prisma.workspaceAiSettings.findUnique({
    where: { workspaceId },
    include: { defaultModel: { include: { provider: true } } },
  })
  if (!settings?.defaultModel) {
    return NextResponse.json(
      { error: 'Workspace AI default model is not configured', code: 'NO_MODEL' },
      { status: 400 },
    )
  }
  // The agents service matches providers by ModelProviderEnum value (lowercased
  // member names). AiProviderKind shares those names, so kind.toLowerCase() is
  // the wire value (see api/agents/generate/route.ts).
  const providerKind = settings.defaultModel.provider.kind.toLowerCase()
  const providerConnection = resolveProviderConnection(settings.defaultModel.provider)
  const modelSlug = settings.defaultModel.slug

  // 8. Ephemeral chat get-or-create (one per user+page) + JWT bound to it.
  const chat = await getOrCreateInlineAiChat(deps.prisma, { userId, workspaceId, pageId })
  const jwt = await deps.signJwt({
    userId,
    workspaceId,
    chatId: chat.id,
    role: editable.role,
  })

  // 9. Server-side prompt + agent-run payload (no MCP; history only for the
  //    refinement loop of generate/custom — spec §4).
  let prompt: string
  if (action === 'generate') {
    prompt = buildGeneratePrompt(instruction as string, { contextBefore })
  } else if (action === 'custom') {
    prompt = buildCustomPrompt(instruction as string, selectedText as string)
  } else if (isInlineAiAction(action)) {
    prompt = buildInlinePrompt(action, selectedText as string, { targetLang })
  } else {
    // Unreachable — already rejected by the allow-list above.
    return NextResponse.json({ error: 'Unknown action', code: 'BAD_ACTION' }, { status: 400 })
  }
  const payload = buildAgentRunPayload({
    chatId: chat.id,
    userMessage: prompt,
    chatHistory: isPreset ? [] : (history ?? []),
    settings: {
      temperature: settings.temperature,
      topP: settings.topP,
      systemPrompt: settings.systemPrompt,
      defaultModel: {
        slug: modelSlug,
        provider: { kind: providerKind, connection: providerConnection },
      },
      embeddingsModel: null,
    },
    mcpServers: [],
    longTermMemories: [],
  })

  // 10. Direct upstream proxy with REAL cancellation: req.signal threads into the
  //     upstream fetch so a client disconnect tears down agents generation.
  const agentsUrl = process.env.AGENTS_URL ?? 'http://localhost:8080'
  let upstream: Response
  try {
    upstream = await deps.upstreamFetch(`${agentsUrl}/agent/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify(payload),
      signal: req.signal,
    })
  } catch {
    return NextResponse.json({ error: 'Upstream unavailable', code: 'UPSTREAM' }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Upstream error', code: 'UPSTREAM' }, { status: 502 })
  }

  const auditOnce = (usage: UpstreamUsage | null) =>
    writeInlineAiAudit(deps.prisma, {
      workspaceId,
      userId,
      preset: action,
      provider: providerKind,
      model: modelSlug,
      pageId,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    })

  const body = pipeUpstream(upstream.body, auditOnce)

  return new Response(body, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    },
  })
}

/**
 * Pipes the upstream agent SSE straight through to the browser while sniffing a
 * `usage` event for the audit. Guards every enqueue/close against a closed
 * controller (the SSE-controller-lifecycle bug) and aborts the upstream reader
 * on a real `cancel()` (client disconnect → agents teardown).
 */
function pipeUpstream(
  upstreamBody: ReadableStream<Uint8Array>,
  audit: (usage: UpstreamUsage | null) => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = upstreamBody.getReader()
  const decoder = new TextDecoder()
  let sseBuffer = ''
  let usage: UpstreamUsage | null = null
  let closed = false
  let audited = false

  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (!closed) {
      closed = true
      try {
        controller.close()
      } catch {
        // Already closed by a concurrent cancel — ignore.
      }
    }
    if (!audited) {
      audited = true
      await audit(usage)
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          await finish(controller)
          return
        }
        if (value && !closed) {
          // Pass the raw upstream bytes through unchanged.
          controller.enqueue(value)
          // Sniff (don't consume) the same bytes for a usage event.
          const text = decoder.decode(value, { stream: true })
          const decoded = decodeSseEvents<{ type: string } & Record<string, unknown>>({
            buffer: sseBuffer,
            chunk: text,
          })
          sseBuffer = decoded.buffer
          for (const ev of decoded.events) {
            const u = readUsage(ev)
            if (u) usage = u
          }
        }
      } catch {
        // Upstream read error (incl. abort) — end the stream + audit what we have.
        await finish(controller)
      }
    },
    async cancel() {
      // Client disconnected: tear down the upstream reader (real cancellation).
      closed = true
      await reader.cancel().catch(() => {})
      if (!audited) {
        audited = true
        await audit(usage)
      }
    },
  })
}

type EditableAccess = { role: AgentsRole }

/**
 * Page edit-access for the inline-AI apply target (spec §3.1 step 2, §7
 * invariant 2). Mirrors `assertActivePageEditAccess`: member of a workspace the
 * caller isn't blocked in, page exists + not trashed, and the caller can edit
 * (creator, OWNER, ADMIN, or EDITOR). Returns null (→ uniform 404) on any
 * failure — no oracle distinguishing "no page" from "no permission".
 */
async function assertPageEditable(
  prisma: Pick<InlineAiDeps['prisma'], 'page' | 'workspaceMember' | 'workspaceBlockedUser'>,
  args: { userId: string; workspaceId: string; pageId: string },
): Promise<EditableAccess | null> {
  const page = await prisma.page.findFirst({
    where: {
      id: args.pageId,
      workspaceId: args.workspaceId,
      deletedAt: null,
      workspace: {
        members: { some: { userId: args.userId } },
        blockedUsers: { none: { userId: args.userId } },
      },
    },
    select: { id: true, createdById: true },
  })
  if (!page) return null

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: args.workspaceId, userId: args.userId } },
    select: { role: true },
  })
  if (!member) return null

  if (page.createdById === args.userId) return { role: member.role as AgentsRole }
  if (EDIT_ROLES.has(member.role)) return { role: member.role as AgentsRole }
  return null
}
