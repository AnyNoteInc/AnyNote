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

function pickHistory(messages: MessageRow[], lastCount: number): MessageRow[] {
  if (messages.length === 0) {
    return []
  }
  if (messages.length <= 1 + lastCount) {
    return messages
  }
  const first = messages[0]!
  const tail = messages.slice(-lastCount).filter((m) => m.id !== first.id)
  return [first, ...tail]
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

    const messages = (await args.prisma.chatMessage.findMany({
      where: { chatId: chain[i], status: 'DONE' satisfies ChatMessageStatus },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, parts: true, createdAt: true },
    })) as MessageRow[]

    const picked = pickHistory(messages, lastCount)
    for (const message of picked) {
      const content = extractText(message.parts)
      if (!content) continue
      conversation.push({ role: mapRole(message.role), content })
    }
  }

  return conversation
}
