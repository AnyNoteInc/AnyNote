import type { OrderedSegment, ServiceBlock, StreamStatus, WebChatSseEvent } from './types'

type Subscriber = (event: WebChatSseEvent) => void

export type ActiveStreamEntry = {
  assistantMessageId: string
  chatId: string
  userMessageId: string
  segments: OrderedSegment[]
  status: StreamStatus
  errorMessage?: string
  upstreamTask: Promise<void> | null
  lastTouchedAt: number
  subscribe: (subscriber: Subscriber) => () => void
  publishCreated: () => void
  publishDelta: (text: string) => void
  publishThinking: (text: string) => void
  publishToolStatus: (block: ServiceBlock) => void
  publishStatus: (status: StreamStatus, errorMessage?: string) => void
  publishDone: () => void
  setUpstreamTask: (task: Promise<void>) => void
  scheduleCleanup: (ttlMs?: number) => void
}

export function createActiveStreamRegistry() {
  const entries = new Map<string, ActiveStreamEntry>()

  function create(args: {
    assistantMessageId: string
    chatId: string
    userMessageId: string
  }): ActiveStreamEntry {
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null
    const subscribers = new Set<Subscriber>()

    const publish = (event: WebChatSseEvent) => {
      entry.lastTouchedAt = Date.now()
      for (const subscriber of subscribers) {
        subscriber(event)
      }
    }

    const entry: ActiveStreamEntry = {
      assistantMessageId: args.assistantMessageId,
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      segments: [],
      status: 'STREAMING',
      errorMessage: undefined,
      upstreamTask: null,
      lastTouchedAt: Date.now(),
      subscribe(subscriber) {
        subscribers.add(subscriber)
        entry.lastTouchedAt = Date.now()
        return () => {
          subscribers.delete(subscriber)
          entry.lastTouchedAt = Date.now()
        }
      },
      publishCreated() {
        publish({
          type: 'message.created',
          assistantMessageId: entry.assistantMessageId,
          userMessageId: entry.userMessageId,
        })
      },
      publishDelta(text) {
        const last = entry.segments.at(-1)
        let index: number
        if (last && last.type === 'text') {
          last.text += text
          index = entry.segments.length - 1
        } else {
          entry.segments.push({ type: 'text', text })
          index = entry.segments.length - 1
        }
        publish({
          type: 'message.delta',
          assistantMessageId: entry.assistantMessageId,
          segmentIndex: index,
          text,
        })
      },
      publishThinking(text) {
        // Reasoning is emitted terminally (after the answer tokens), but it
        // renders ABOVE the answer as the "Размышления" block, so the thinking
        // segment lives at the FRONT of the ordered list — mirrored exactly by the
        // client's `appendAssistantThinking` (which unshifts). Keeping both sides
        // front-placed means the persisted segments equal the live order, so the
        // post-stream getChat refetch doesn't reorder the bubble.
        const first = entry.segments[0]
        if (first && first.type === 'thinking') {
          first.text += text
        } else {
          entry.segments.unshift({ type: 'thinking', text })
        }
        // Emit a fast-path `message.thinking` delta (not a `message.segments`
        // snapshot): thinking streams like text, and the client appends it to its
        // own leading thinking segment. The segment is kept in `entry.segments`
        // for persistence.
        publish({
          type: 'message.thinking',
          assistantMessageId: entry.assistantMessageId,
          text,
        })
      },
      publishToolStatus(block) {
        const idx = entry.segments.findIndex((s) => s.type === 'tool' && s.id === block.id)
        const seg: OrderedSegment = {
          type: 'tool',
          id: block.id,
          kind: block.kind,
          state: block.state,
          title: block.title,
          ...(block.detail !== undefined ? { detail: block.detail } : {}),
          ...(block.result !== undefined ? { result: block.result } : {}),
        }
        if (idx >= 0) {
          entry.segments[idx] = seg
        } else {
          entry.segments.push(seg)
        }
        publish({
          type: 'message.segments',
          assistantMessageId: entry.assistantMessageId,
          segments: structuredClone(entry.segments),
        })
      },
      publishStatus(status, errorMessage) {
        entry.status = status
        entry.errorMessage = errorMessage
        publish({
          type: 'message.status',
          assistantMessageId: entry.assistantMessageId,
          status,
          errorMessage,
        })
      },
      publishDone() {
        publish({
          type: 'message.done',
          assistantMessageId: entry.assistantMessageId,
        })
      },
      setUpstreamTask(task) {
        entry.upstreamTask = task
      },
      scheduleCleanup(ttlMs = 30_000) {
        if (cleanupTimer) {
          clearTimeout(cleanupTimer)
        }
        cleanupTimer = setTimeout(() => {
          entries.delete(entry.assistantMessageId)
        }, ttlMs)
      },
    }

    entries.set(args.assistantMessageId, entry)
    return entry
  }

  return {
    create,
    delete: (assistantMessageId: string) => entries.delete(assistantMessageId),
    entries,
    get: (assistantMessageId: string) => entries.get(assistantMessageId),
  }
}

export const activeStreamRegistry = createActiveStreamRegistry()
