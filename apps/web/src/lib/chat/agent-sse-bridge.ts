import { prisma } from '@repo/db'

import { activeStreamRegistry } from './active-stream-registry'
import { decodeSseEvents, encodeSseEvent } from './sse'
import type { ServiceBlock } from './types'

// ---------------------------------------------------------------------------
// Part builders
// ---------------------------------------------------------------------------

type ValidChatFile = { id: string; name: string; mimeType: string; fileSize: bigint }

export function createTextPart(text: string) {
  return { type: 'text' as const, text }
}

export function createAttacmentPart(file: ValidChatFile) {
  return {
    type: 'attacment' as const,
    fileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    fileSize: file.fileSize.toString(),
  }
}

export function createToolPart(block: ServiceBlock) {
  return { type: 'tool' as const, ...block }
}

export function createAssistantParts(entry: ReturnType<typeof activeStreamRegistry.create>) {
  return [
    ...(entry.content.length > 0 ? [createTextPart(entry.content)] : []),
    ...entry.blocks.map(createToolPart),
  ]
}

// ---------------------------------------------------------------------------
// Debounced persist
// ---------------------------------------------------------------------------

export function createDebouncedPersist(args: {
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

// ---------------------------------------------------------------------------
// SSE response factory
// ---------------------------------------------------------------------------

export function createEntryResponse(args: {
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
          if (event.type === 'message.done') {
            unsubscribe()
            controller.close()
          }
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

// ---------------------------------------------------------------------------
// Agent-protocol SSE → registry translator
// ---------------------------------------------------------------------------

// Shape of events emitted by /agent/run and /agent/resume
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

function upsertServiceBlock(blocks: ServiceBlock[], block: ServiceBlock): ServiceBlock[] {
  const next = [...blocks]
  const idx = next.findIndex((b) => b.id === block.id)
  if (idx >= 0) {
    next[idx] = block
    return next
  }
  next.push(block)
  return next
}

type EntryHandle = ReturnType<typeof activeStreamRegistry.create>
type PersistHandle = ReturnType<typeof createDebouncedPersist>

function handleAgentEvent(
  event: AgentRunSseEvent,
  entry: EntryHandle,
  flush: PersistHandle,
): boolean {
  switch (event.type) {
    case 'token':
      entry.publishDelta(event.text)
      flush.schedule()
      return false
    case 'tool_status':
      entry.publishBlocks(
        upsertServiceBlock(entry.blocks, {
          id: event.id,
          kind: 'tool',
          state: event.state,
          title: event.title,
          detail: event.detail,
        }),
      )
      flush.schedule()
      return false
    case 'plan_step':
      entry.publishBlocks(
        upsertServiceBlock(entry.blocks, {
          id: `plan-${event.id}`,
          kind: 'tool',
          state: mapPlanStepStatus(event.status),
          title: event.title,
        }),
      )
      return false
    case 'step_started':
      updateExistingPlanBlock(entry, event.step_id, { state: 'running' })
      return false
    case 'step_completed':
      updateExistingPlanBlock(entry, event.step_id, {
        state: 'done',
        result: event.result_summary,
      })
      return false
    case 'confirmation_required':
      entry.publishBlocks(
        upsertServiceBlock(entry.blocks, {
          id: event.confirmation_id,
          kind: 'confirmation',
          state: 'required',
          title: event.summary,
          detail: JSON.stringify({
            confirmation_id: event.confirmation_id,
            tool: event.tool,
            summary: event.summary,
            args_preview: event.args_preview,
          }),
        }),
      )
      return false
    case 'error':
      entry.publishStatus('ERROR', event.message)
      return true
    case 'done':
      entry.publishStatus('DONE')
      return true
    default:
      // router_decision, memory_write_proposed, critic_verdict, citation, usage — no-op
      return false
  }
}

function updateExistingPlanBlock(
  entry: EntryHandle,
  stepId: string,
  patch: Partial<ServiceBlock>,
): void {
  const planBlockId = `plan-${stepId}`
  const existing = entry.blocks.find((b) => b.id === planBlockId)
  if (!existing) return
  entry.publishBlocks(
    upsertServiceBlock(entry.blocks, { ...existing, ...patch } as ServiceBlock),
  )
}

export async function streamAgentSseToRegistry(args: {
  assistantMessageId: string
  chatId: string
  entry: EntryHandle
  jwt: string
  upstreamUrl: string
  upstreamBody: unknown
}) {
  const flush = createDebouncedPersist({
    assistantMessageId: args.assistantMessageId,
    entry: args.entry,
  })

  try {
    const upstream = await fetch(args.upstreamUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.jwt}`,
      },
      body: JSON.stringify(args.upstreamBody),
    })

    if (!upstream.ok || !upstream.body) {
      args.entry.publishStatus('ERROR', `Agents upstream ${upstream.status}`)
      return
    }

    const completed = await consumeAgentSse(upstream.body, args.entry, flush)
    if (!completed) args.entry.publishStatus('DONE')
  } catch (error) {
    args.entry.publishStatus(
      'ERROR',
      error instanceof Error ? error.message : 'Agents upstream failed',
    )
  } finally {
    await flush.flush()
    args.entry.publishDone()
    args.entry.scheduleCleanup()
  }
}

async function consumeAgentSse(
  body: ReadableStream<Uint8Array>,
  entry: EntryHandle,
  flush: PersistHandle,
): Promise<boolean> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  while (!completed) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    const parsed = decodeSseEvents<AgentRunSseEvent>({ buffer, chunk })
    buffer = parsed.buffer

    for (const event of parsed.events) {
      if (handleAgentEvent(event, entry, flush)) {
        completed = true
        break
      }
    }
  }

  return completed
}

export type { WebChatSseEvent } from './types'
