import type { ChatMessageRole, ChatMessageStatus, Prisma, PrismaClient } from '@repo/db'

import type { AgentConversationMessage } from './agents-payload'

const MAX_ANCESTORS = 50
const CURRENT_CHAT_LAST_COUNT = 10
const ANCESTOR_LAST_COUNT = 4

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

function extractText(parts: Prisma.JsonValue): string {
  if (!Array.isArray(parts)) {
    return ''
  }
  return parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join('\n\n')
    .trim()
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
  lastCount: number,
): Promise<MessageRow[]> {
  const where: Prisma.ChatMessageWhereInput = {
    chatId,
    status: 'DONE' satisfies ChatMessageStatus,
  }
  const select = { id: true, role: true, parts: true, createdAt: true } as const

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

  for (let i = 0; i < chain.length; i += 1) {
    const isCurrent = i === chain.length - 1
    const lastCount = isCurrent ? CURRENT_CHAT_LAST_COUNT : ANCESTOR_LAST_COUNT

    const messages = await fetchBoundedHistory(args.prisma, chain[i]!, lastCount)

    for (const message of messages) {
      const content = extractText(message.parts)
      if (!content) continue
      conversation.push({ role: mapRole(message.role), content })
    }
  }

  return conversation
}
