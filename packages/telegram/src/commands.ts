import type { Prisma, PrismaClient } from '@repo/db'

import {
  renderDenied,
  renderEmptyScope,
  renderHelp,
  renderLinkInvalid,
  renderLinkSuccess,
  renderNotFound,
  renderNotLinked,
  renderPageCard,
  renderSearchResults,
  renderSearchUsage,
  renderUnknownCommand,
} from './render.ts'
import { hashLinkCode } from './secret.ts'

/**
 * Minimal inbound Telegram `Update` shape — only the fields the router reads.
 * `my_chat_member` is handled by the webhook route (chat registry), never here.
 */
export type TelegramUpdate = {
  message?: {
    chat: { id: number | string; type?: string; title?: string }
    from?: { id: number | string; username?: string }
    text?: string
  }
  my_chat_member?: unknown
}

/** String-literal mirror of the `TelegramCommandResult` Prisma enum. */
export type TelegramCommandResultValue = 'OK' | 'DENIED' | 'ERROR'

/**
 * Everything the route handler needs to persist a `TelegramBotCommandAudit`
 * row (it adds `connectionId`). `null` only for non-command messages —
 * every command, including unknown ones and denials, is audited.
 */
export type CommandAudit = {
  command: string
  argsSummary: string | null
  result: TelegramCommandResultValue
  detail: string | null
  telegramUserId: string
  linkedUserId: string | null
  chatId: string
}

export type RouteUpdateResult = { reply: string | null; audit: CommandAudit | null }

const ARGS_SUMMARY_MAX = 200
/** Cap on what reaches Prisma `contains` — same width as the audit summary. */
const SEARCH_QUERY_MAX = 200
const SEARCH_LIMIT = 5
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Replica of `excludeDatabaseRowPages()` from `@repo/domain/pages/page-visibility.ts`
 * (kept inline — this tier-2 package depends only on adapters, the 7A precedent).
 * The explicit `parentId: null` branch keeps root pages visible: the relation
 * filter alone is false when there is no parent (root-page bug).
 */
const EXCLUDE_DATABASE_ROW_PAGES: Prisma.PageWhereInput = {
  OR: [{ parentId: null }, { parent: { is: { type: { not: 'DATABASE' } } } }],
}

function pageUrl(pageId: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/pages/${pageId}`
}

function truncateArgs(args: string): string | null {
  const trimmed = args.trim()
  return trimmed === '' ? null : trimmed.slice(0, ARGS_SUMMARY_MAX)
}

type CommandContext = {
  prisma: PrismaClient
  connection: { id: string; workspaceId: string }
  chatId: string
  telegramUserId: string
  username: string | null
  link: { userId: string } | null
}

function buildAudit(
  ctx: CommandContext,
  command: string,
  fields: {
    argsSummary?: string | null
    result: TelegramCommandResultValue
    detail?: string | null
    linkedUserId?: string | null
  },
): CommandAudit {
  return {
    command,
    argsSummary: fields.argsSummary ?? null,
    result: fields.result,
    detail: fields.detail ?? null,
    telegramUserId: ctx.telegramUserId,
    linkedUserId:
      fields.linkedUserId !== undefined ? fields.linkedUserId : (ctx.link?.userId ?? null),
    chatId: ctx.chatId,
  }
}

/**
 * Shared `/search` + `/get` gate: linked → member → chat has subscriptions.
 * Returns the subscribed collection ids, or the ladder denial to relay.
 */
async function resolveCommandScope(
  ctx: CommandContext,
  command: string,
  argsSummary: string | null,
): Promise<{ collectionIds: string[] } | { failure: RouteUpdateResult }> {
  if (ctx.link === null) {
    return {
      failure: {
        reply: renderNotLinked(),
        audit: buildAudit(ctx, command, { argsSummary, result: 'DENIED', detail: 'not-linked' }),
      },
    }
  }
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: ctx.connection.workspaceId, userId: ctx.link.userId },
    },
    select: { id: true },
  })
  if (member === null) {
    return {
      failure: {
        reply: renderDenied(),
        audit: buildAudit(ctx, command, { argsSummary, result: 'DENIED', detail: 'not-member' }),
      },
    }
  }
  const chat = await ctx.prisma.telegramChat.findUnique({
    where: { connectionId_chatId: { connectionId: ctx.connection.id, chatId: ctx.chatId } },
    select: { subscriptions: { select: { collectionId: true } } },
  })
  const collectionIds = chat?.subscriptions.map((s) => s.collectionId) ?? []
  if (collectionIds.length === 0) {
    return {
      failure: {
        reply: renderEmptyScope(),
        audit: buildAudit(ctx, command, { argsSummary, result: 'OK', detail: 'no-scope' }),
      },
    }
  }
  return { collectionIds }
}

function handleHelp(ctx: CommandContext): RouteUpdateResult {
  return { reply: renderHelp(), audit: buildAudit(ctx, 'help', { result: 'OK' }) }
}

/** In-tx steal-guard conflict — thrown to roll back a just-claimed link code. */
class TelegramAlreadyLinkedError extends Error {
  constructor() {
    super('telegram account already linked to another user')
  }
}

/**
 * `/link <code>`: codes are sha256-hashed at rest, single-use, TTL-bounded.
 * All denial branches share ONE reply (no oracle over code state) while the
 * audit `detail` stays distinct. The plaintext code NEVER lands in the audit.
 */
async function handleLink(ctx: CommandContext, args: string): Promise<RouteUpdateResult> {
  const denied = (detail: string): RouteUpdateResult => ({
    reply: renderLinkInvalid(),
    audit: buildAudit(ctx, 'link', { result: 'DENIED', detail }),
  })

  const code = args.trim().toUpperCase()
  if (code === '') return denied('code-missing')

  // DIAGNOSIS read only — it yields the precise audit detail (unknown vs used
  // vs expired). The actual single-use gate is the guarded UPDATE below; this
  // row may be stale by the time we claim.
  const row = await ctx.prisma.telegramLinkCode.findUnique({
    where: { codeHash: hashLinkCode(code) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  })
  if (row === null) return denied('code-unknown')
  if (row.usedAt !== null) return denied('code-used')
  if (row.expiresAt.getTime() <= Date.now()) return denied('code-expired')

  // This Telegram account may already be bound to a DIFFERENT user —
  // `telegramUserId` is unique, silently stealing the binding is not allowed.
  // (Re-checked INSIDE the transaction; this early read keeps the common
  // denial cheap and the code unconsumed.)
  const existing = await ctx.prisma.telegramUserLink.findUnique({
    where: { telegramUserId: ctx.telegramUserId },
    select: { userId: true },
  })
  if (existing !== null && existing.userId !== row.userId) {
    return denied('telegram-already-linked')
  }

  try {
    const outcome = await ctx.prisma.$transaction(async (tx) => {
      // Atomic claim: validity lives in the UPDATE's WHERE (one guarded
      // statement), so two concurrent /link calls can never both consume the
      // code — the loser's update matches 0 rows once the winner commits.
      const claimed = await tx.telegramLinkCode.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      })
      // Raced away (or expired at the boundary) between diagnosis and claim.
      if (claimed.count === 0) return 'code-used' as const

      // Re-run the steal guard inside the tx — a concurrent /link may have
      // bound this Telegram account meanwhile. Throw to roll back the claim.
      const concurrent = await tx.telegramUserLink.findUnique({
        where: { telegramUserId: ctx.telegramUserId },
        select: { userId: true },
      })
      if (concurrent !== null && concurrent.userId !== row.userId) {
        throw new TelegramAlreadyLinkedError()
      }

      // Upsert on the user — a re-link from a new Telegram account REPLACES
      // the user's previous link (one link per user, one user per account).
      await tx.telegramUserLink.upsert({
        where: { userId: row.userId },
        create: { userId: row.userId, telegramUserId: ctx.telegramUserId, username: ctx.username },
        update: { telegramUserId: ctx.telegramUserId, username: ctx.username, linkedAt: new Date() },
      })
      return 'linked' as const
    })
    if (outcome !== 'linked') return denied(outcome)
  } catch (error) {
    // P2002: a concurrent insert won the `telegram_user_id` unique race after
    // our in-tx guard. Either way the tx — and the claim — rolled back.
    if (
      error instanceof TelegramAlreadyLinkedError ||
      (error as { code?: string }).code === 'P2002'
    ) {
      return denied('telegram-already-linked')
    }
    throw error
  }

  return {
    reply: renderLinkSuccess(),
    audit: buildAudit(ctx, 'link', { result: 'OK', linkedUserId: row.userId }),
  }
}

async function handleSearch(ctx: CommandContext, args: string): Promise<RouteUpdateResult> {
  const argsSummary = truncateArgs(args)
  const scope = await resolveCommandScope(ctx, 'search', argsSummary)
  if ('failure' in scope) return scope.failure

  const query = args.trim().slice(0, SEARCH_QUERY_MAX)
  if (query === '') {
    return {
      reply: renderSearchUsage(),
      audit: buildAudit(ctx, 'search', { argsSummary, result: 'OK', detail: 'empty-query' }),
    }
  }

  const pages = await ctx.prisma.page.findMany({
    where: {
      workspaceId: ctx.connection.workspaceId,
      collectionId: { in: scope.collectionIds },
      deletedAt: null,
      archivedAt: null,
      title: { contains: query, mode: 'insensitive' },
      AND: [EXCLUDE_DATABASE_ROW_PAGES],
    },
    orderBy: { updatedAt: 'desc' },
    take: SEARCH_LIMIT,
    select: { id: true, title: true },
  })

  return {
    reply: renderSearchResults(pages.map((p) => ({ title: p.title ?? '', url: pageUrl(p.id) }))),
    audit: buildAudit(ctx, 'search', { argsSummary, result: 'OK' }),
  }
}

async function handleGet(ctx: CommandContext, args: string): Promise<RouteUpdateResult> {
  const argsSummary = truncateArgs(args)
  const scope = await resolveCommandScope(ctx, 'get', argsSummary)
  if ('failure' in scope) return scope.failure

  const notFound = (detail: string): RouteUpdateResult => ({
    // ONE reply for malformed / nonexistent / out-of-scope / trashed —
    // byte-identical by construction, no existence oracle.
    reply: renderNotFound(),
    audit: buildAudit(ctx, 'get', { argsSummary, result: 'OK', detail }),
  })

  const pageId = args.trim()
  if (!UUID_RE.test(pageId)) return notFound('invalid-id')

  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspaceId: ctx.connection.workspaceId,
      collectionId: { in: scope.collectionIds },
      deletedAt: null,
      archivedAt: null,
      AND: [EXCLUDE_DATABASE_ROW_PAGES],
    },
    select: { id: true, title: true, updatedAt: true },
  })
  if (page === null) return notFound('not-found')

  return {
    reply: renderPageCard({
      title: page.title ?? '',
      url: pageUrl(page.id),
      updatedAt: page.updatedAt,
    }),
    audit: buildAudit(ctx, 'get', { argsSummary, result: 'OK' }),
  }
}

function handleUnknown(ctx: CommandContext, rawCommand: string): RouteUpdateResult {
  return {
    reply: renderUnknownCommand(),
    audit: buildAudit(ctx, 'unknown', {
      // Only the command TOKEN — args of a mistyped /link could be a live code.
      argsSummary: truncateArgs(rawCommand),
      result: 'OK',
      detail: 'unknown-command',
    }),
  }
}

/**
 * Pure command router: parses the update, runs the §5 permission ladder with
 * plain Prisma queries, and returns the reply text + audit record. NO Telegram
 * I/O here — the webhook route sends the reply and persists the audit.
 */
export async function routeUpdate(
  prisma: PrismaClient,
  connection: { id: string; workspaceId: string },
  update: TelegramUpdate,
): Promise<RouteUpdateResult> {
  const message = update.message
  const text = message?.text?.trim() ?? ''
  // Non-command messages (and senderless channel posts) are not routed or audited.
  if (message === undefined || message.from === undefined || !text.startsWith('/')) {
    return { reply: null, audit: null }
  }

  const telegramUserId = String(message.from.id)
  const [rawCommand = '', ...rest] = text.split(/\s+/)
  // `/cmd@BotName` is how groups address a specific bot — strip the mention.
  const command = (rawCommand.slice(1).split('@')[0] ?? '').toLowerCase()
  const args = rest.join(' ')

  const link = await prisma.telegramUserLink.findUnique({
    where: { telegramUserId },
    select: { userId: true },
  })
  const ctx: CommandContext = {
    prisma,
    connection,
    chatId: String(message.chat.id),
    telegramUserId,
    username: message.from.username ?? null,
    link,
  }

  switch (command) {
    case 'help':
      return handleHelp(ctx)
    case 'link':
      return handleLink(ctx, args)
    case 'search':
      return handleSearch(ctx, args)
    case 'get':
      return handleGet(ctx, args)
    default:
      return handleUnknown(ctx, rawCommand)
  }
}
