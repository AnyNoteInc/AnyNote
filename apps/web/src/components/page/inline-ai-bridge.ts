// The apps/web inline-AI streaming bridge (spec §4.3, plan Task 4 Step 1).
//
// The editor package owns NO tRPC/fetch (Bundler resolution, no web deps). It
// declares the injection contract (`AskAICallback`/`AskAIArgs`/`AskAIHandle` in
// `@repo/editor` types) and apps/web provides the implementation here. This
// factory builds an `askAI` closure bound to a page + workspace; the popover
// calls it once per action-pick and wires the returned handle's callbacks into
// the InlineAI plugin metas (onToken → appendToken, done → finish, onError →
// fail).
//
// It is framework-light (no React) so `page-renderer.tsx` can `useMemo` it.
//
// THE WIRE FORMAT — what we parse: `/api/ai/inline` (Task 2 `handler.ts`
// `pipeUpstream`) proxies the upstream agents `/agent/run` SSE through UNCHANGED.
// So the frames the browser receives are the raw agents `AgentRunSseEvent`
// shape (see apps/web/src/lib/chat/agent-sse-bridge.ts), SSE-encoded as
// `data: {json}\n\n`:
//   { type: 'token',  text: string }   → a text delta (fed to onToken)
//   { type: 'thinking', text: string } → reasoning (ignored for inline)
//   { type: 'error',  code, message }  → upstream error (→ onError)
//   { type: 'done' }                   → stream end
//   tool_status / plan_step / usage / … → ignored for inline transforms
//
// The HTTP-level errors (the route's own NextResponse.json) are NOT SSE frames —
// they're a JSON body on a non-OK response: `{ error, code }` with code one of
// UNAUTHORIZED / BAD_REQUEST / BAD_ACTION / NOT_FOUND / PLAN / RATE_LIMIT /
// NO_MODEL / UPSTREAM. We map those to the spec §4.2 user copy before onError.

import type {
  AskAIArgs,
  AskAICallback,
  AskAIHandle,
  GenerateAiArgs,
  GenerateAICallback,
} from '@repo/editor'

const CONFIGURE_AI = 'Настройте AI-агента в настройках'
const PLAN_UPSELL = 'Доступно на тарифе ПРО и выше'
const TOO_MANY = 'Слишком много запросов, попробуйте позже'
const GENERIC = 'Не удалось получить ответ ИИ. Попробуйте ещё раз.'

/** Map a non-OK `/api/ai/inline` response `{error, code}` to user-facing copy. */
function messageForErrorResponse(status: number, code: string | undefined): string {
  if (code === 'PLAN') return PLAN_UPSELL
  // 400 (no default model / bad action / bad request) → "configure".
  if (code === 'NO_MODEL' || status === 400 || status === 403) return CONFIGURE_AI
  if (code === 'RATE_LIMIT' || status === 429) return TOO_MANY
  return GENERIC
}

type InlineSseEvent = { type: string; text?: string; message?: string }

/**
 * Split an accumulated SSE buffer into complete `data:` frames, returning the
 * parsed events plus the unterminated trailing buffer. Mirrors the chat
 * `decodeSseEvents` line-split (split on blank lines, keep `data:` lines).
 */
function decodeFrames(buffer: string): { events: InlineSseEvent[]; rest: string } {
  const frames = buffer.split(/\r?\n\r?\n/)
  const rest = frames.pop() ?? ''
  const events: InlineSseEvent[] = []
  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data) continue
    try {
      const parsed = JSON.parse(data) as unknown
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        events.push(parsed as InlineSseEvent)
      }
    } catch {
      // Ignore a partial / malformed frame.
    }
  }
  return { events, rest }
}

/** Shared SSE streaming core: POST the given body to /api/ai/inline and expose
 *  the AskAIHandle contract (done never rejects, onError at most once). */
function streamInlineAi(body: Record<string, unknown>): AskAIHandle {
  const controller = new AbortController()
  const tokenCbs: Array<(delta: string) => void> = []
  const errorCbs: Array<(message: string) => void> = []
  let errored = false

  const emitToken = (delta: string) => {
    for (const cb of tokenCbs) cb(delta)
  }
  const emitError = (message: string) => {
    // Fire onError at most once — `done` still resolves (never rejects).
    if (errored) return
    errored = true
    for (const cb of errorCbs) cb(message)
  }

  const run = async (): Promise<void> => {
    let res: Response
    try {
      res = await fetch('/api/ai/inline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch {
      // A network failure or an abort during the request phase.
      if (!controller.signal.aborted) emitError(GENERIC)
      return
    }

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { code?: string } | null
      emitError(messageForErrorResponse(res.status, payload?.code))
      return
    }
    if (!res.body) {
      emitError(GENERIC)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = decodeFrames(buffer)
        buffer = rest
        for (const ev of events) {
          if (ev.type === 'token' && typeof ev.text === 'string') {
            emitToken(ev.text)
          } else if (ev.type === 'error') {
            emitError(ev.message || GENERIC)
          }
          // 'done' / 'thinking' / tool_status / usage → no inline action.
        }
      }
      // Flush any complete frame left in the buffer (no trailing blank line).
      const { events } = decodeFrames(buffer + '\n\n')
      for (const ev of events) {
        if (ev.type === 'token' && typeof ev.text === 'string') emitToken(ev.text)
        else if (ev.type === 'error') emitError(ev.message || GENERIC)
      }
    } catch {
      // A read error or an abort mid-stream. An abort is intentional (retry /
      // discard / unmount) and must NOT surface as an error.
      if (!controller.signal.aborted) emitError(GENERIC)
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  // `done` resolves on success OR error OR abort — it NEVER rejects (contract).
  const done = run().catch(() => {
    if (!controller.signal.aborted && !errored) emitError(GENERIC)
  })

  return {
    onToken: (cb) => {
      tokenCbs.push(cb)
    },
    onError: (cb) => {
      errorCbs.push(cb)
    },
    done,
    abort: () => {
      if (!controller.signal.aborted) controller.abort()
    },
  }
}

/**
 * Build the `askAI` closure bound to a page + workspace. One call per
 * action-pick → one `/api/ai/inline` request → one `AskAIHandle`.
 */
export function createAskAI(ctx: { pageId: string; workspaceId: string }): AskAICallback {
  return (args: AskAIArgs): AskAIHandle =>
    streamInlineAi({
      action: args.action,
      selectedText: args.selectedText,
      pageId: ctx.pageId,
      workspaceId: ctx.workspaceId,
      ...(args.targetLang ? { targetLang: args.targetLang } : {}),
      ...(args.instruction ? { instruction: args.instruction } : {}),
      ...(args.history?.length ? { history: args.history } : {}),
    })
}

/**
 * Build the `generateAI` closure bound to a page + workspace (spec §3, the
 * space-bar drafting bridge). One call per AI-bar submit → one
 * `/api/ai/inline` `generate` request → one `AskAIHandle`.
 */
export function createGenerateAi(ctx: { pageId: string; workspaceId: string }): GenerateAICallback {
  return (args: GenerateAiArgs): AskAIHandle =>
    streamInlineAi({
      action: 'generate',
      instruction: args.instruction,
      history: args.history,
      ...(args.contextBefore ? { contextBefore: args.contextBefore } : {}),
      pageId: ctx.pageId,
      workspaceId: ctx.workspaceId,
    })
}
