import type { PrismaClient } from '@repo/db'

/**
 * Resolve (or lazily create) the hidden ephemeral chat that backs all inline-AI
 * invocations for a given `(user, page)` (spec §3, §5). One per pair, reused
 * across actions so the LangGraph checkpointer/history isn't spammed.
 *
 * Race-safe via the partial-unique constraint `chat_inline_ai_user_page`
 * (`@@unique([createdById, inlineAiPageId])` — Postgres treats NULLs as
 * distinct, so only INLINE_AI rows participate): two concurrent first-actions
 * converge on a P2002 to a re-find rather than creating duplicates.
 */
export async function getOrCreateInlineAiChat(
  prisma: Pick<PrismaClient, 'chat'>,
  args: { userId: string; workspaceId: string; pageId: string },
): Promise<{ id: string }> {
  const where = {
    kind: 'INLINE_AI' as const,
    createdById: args.userId,
    inlineAiPageId: args.pageId,
  }

  const existing = await prisma.chat.findFirst({ where, select: { id: true } })
  if (existing) return existing

  try {
    return await prisma.chat.create({
      data: {
        kind: 'INLINE_AI',
        createdById: args.userId,
        workspaceId: args.workspaceId,
        inlineAiPageId: args.pageId,
        title: 'Inline AI',
      },
      select: { id: true },
    })
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      const row = await prisma.chat.findFirst({ where, select: { id: true } })
      if (row) return row
    }
    throw e
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'
  )
}
