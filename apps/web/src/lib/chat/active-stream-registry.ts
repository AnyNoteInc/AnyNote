import type { ServiceBlock, StreamStatus, WebChatSseEvent } from './types'

type Subscriber = (event: WebChatSseEvent) => void

export type ActiveStreamEntry = {
  assistantMessageId: string
  chatId: string
  userMessageId: string
  content: string
  blocks: ServiceBlock[]
  status: StreamStatus
  errorMessage?: string
  upstreamTask: Promise<void> | null
  lastTouchedAt: number
  subscribe: (subscriber: Subscriber) => () => void
  publishCreated: () => void
  publishDelta: (text: string) => void
  publishBlocks: (blocks: ServiceBlock[]) => void
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
      content: '',
      blocks: [],
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
        entry.content += text
        publish({
          type: 'message.delta',
          assistantMessageId: entry.assistantMessageId,
          text,
        })
      },
      publishBlocks(blocks) {
        entry.blocks = blocks
        publish({
          type: 'message.service',
          assistantMessageId: entry.assistantMessageId,
          blocks,
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
