import type { ChatMessageRole, ChatMessageStatus, Prisma, PrismaClient } from '@repo/db'

import type { AgentConversationMessage } from './agents-payload'

const MAX_ANCESTORS = 50
const CURRENT_CHAT_LAST_COUNT = 10
const ANCESTOR_LAST_COUNT = 4
const FULL_THREAD_MAX_MESSAGES = 200

type MessageRow = {
  id: string
  role: ChatMessageRole
  parts: Prisma.JsonValue
  createdAt: Date
}

type ChatNode = { id: string; parentId: string | null }

type PrismaLike = {
  chat: {
    findFirst: (args: {
      where: { id: string; workspaceId: string }
      select: { id: true; parentId: true }
    }) => Promise<ChatNode | null>
  }
  chatMessage: {
    findMany: PrismaClient['chatMessage']['findMany']
  }
}

function isTextPart(value: unknown): value is { type: 'text'; text: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  )
}

function isToolPart(value: unknown): value is { type: 'tool'; title?: string; detail?: string } {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'tool'
}

/** Tool name for the history summary line: the machine name from `detail`
 *  (JSON `{tool}` — the shape ChatServiceBlock parses) beats the human title. */
function toolName(part: { title?: string; detail?: string }): string | null {
  if (part.detail) {
    try {
      const parsed = JSON.parse(part.detail) as { tool?: unknown }
      if (typeof parsed.tool === 'string' && parsed.tool) return parsed.tool
    } catch {
      // fall through to title
    }
  }
  return typeof part.title === 'string' && part.title ? part.title : null
}

function extractText(parts: Prisma.JsonValue): string {
  if (!Array.isArray(parts)) {
    return ''
  }
  const text = parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join('\n\n')
    .trim()
  // Tool calls used to vanish from history entirely (and tool-ONLY turns
  // dropped the whole message), breaking follow-ups like «добавь ЭТО в конец
  // страницы» right after a tool call. Keep the thread coherent with a
  // summary line — appended to the turn's text, or standing alone for
  // tool-only turns.
  const tools = parts
    .filter(isToolPart)
    .map(toolName)
    .filter((name): name is string => name !== null)
  if (tools.length === 0) {
    return text
  }
  const summary = `[Выполнены инструменты: ${[...new Set(tools)].join(', ')}]`
  return text ? `${text}\n\n${summary}` : summary
}

// Bound the per-chat fetch using the (chatId, createdAt) index: pull the
// last-N window (DESC + take) and the conversation's first message
// (ASC + take:1) separately, then merge into the [first, ...last] shape the
// old in-JS pickHistory produced — without scanning every message row.
// Assumes lastCount >= 1 (callers pass 10 / 4); at lastCount === 0 the last-N
// window is empty and the output collapses to just [first].
async function fetchBoundedHistory(
  prisma: PrismaLike,
  chatId: string,
  lastCount: number | 'all',
): Promise<MessageRow[]> {
  const where: Prisma.ChatMessageWhereInput = {
    chatId,
    status: 'DONE' satisfies ChatMessageStatus,
  }
  const select = { id: true, role: true, parts: true, createdAt: true } as const

  // Page chats ship their WHOLE thread («вся история», spec §5) — they are
  // page-scoped and short-lived; the agents-side trim_chat_history cap stays
  // as the context-window safety valve, and FULL_THREAD_MAX_MESSAGES bounds a
  // pathological thread so the per-send fetch can't grow without limit.
  if (lastCount === 'all') {
    const lastDesc = (await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: FULL_THREAD_MAX_MESSAGES,
      select,
    })) as MessageRow[]
    return lastDesc.reverse()
  }

  const [lastDesc, firstRows] = await Promise.all([
    prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: lastCount,
      select,
    }) as Promise<MessageRow[]>,
    prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 1,
      select,
    }) as Promise<MessageRow[]>,
  ])

  const lastAsc = [...lastDesc].reverse()
  const first = firstRows[0]
  if (!first) {
    return lastAsc
  }
  return [first, ...lastAsc.filter((m) => m.id !== first.id)]
}

function mapRole(role: ChatMessageRole): AgentConversationMessage['role'] {
  return role === 'USER' ? 'user' : 'assistant'
}

export async function buildChatHistoryMessages(args: {
  prisma: PrismaLike
  chatId: string
  workspaceId: string
  /** PAGE chats send the full current-chat thread instead of the last-10 window. */
  fullCurrentChat?: boolean
}): Promise<AgentConversationMessage[]> {
  const chain: string[] = []
  let cursorId: string | null = args.chatId
  let depth = 0

  while (cursorId && depth < MAX_ANCESTORS) {
    const node = await args.prisma.chat.findFirst({
      where: { id: cursorId, workspaceId: args.workspaceId },
      select: { id: true, parentId: true },
    })
    if (!node) {
      break
    }
    chain.unshift(node.id)
    cursorId = node.parentId
    depth += 1
  }

  const conversation: AgentConversationMessage[] = []

  const currentWindow = args.fullCurrentChat ? ('all' as const) : CURRENT_CHAT_LAST_COUNT

  for (let i = 0; i < chain.length; i += 1) {
    const isCurrent = i === chain.length - 1
    const lastCount = isCurrent ? currentWindow : ANCESTOR_LAST_COUNT

    const messages = await fetchBoundedHistory(args.prisma, chain[i]!, lastCount)

    for (const message of messages) {
      const content = extractText(message.parts)
      if (!content) continue
      pushConversationMessage(conversation, mapRole(message.role), content)
    }
  }

  return conversation
}

/** Strict-alternation providers (e.g. GigaChat) reject consecutive same-role
 *  messages; formerly-skipped tool-only turns can now produce them, so merge
 *  adjacent same-role turns instead of pushing a second one. */
function pushConversationMessage(
  conversation: AgentConversationMessage[],
  role: AgentConversationMessage['role'],
  content: string,
): void {
  const previous = conversation.at(-1)
  if (previous?.role === role) {
    previous.content = `${previous.content}\n\n${content}`
    return
  }
  conversation.push({ role, content })
}
