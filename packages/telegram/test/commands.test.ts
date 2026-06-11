import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptSecret } from '@repo/auth/secret-encryption.ts'
import { prisma, CollectionKind, type Prisma } from '@repo/db'

import { routeUpdate, type TelegramUpdate } from '../src/commands.ts'
import {
  renderDenied,
  renderEmptyScope,
  renderHelp,
  renderLinkInvalid,
  renderLinkSuccess,
  renderNotFound,
  renderNotLinked,
  renderSearchResults,
} from '../src/render.ts'
import { generateLinkCode, hashLinkCode } from '../src/secret.ts'

// Real-DB integration test for the pure command router (§5 permission ladder).
// Self-cleaning via an email-suffix fixture namespace, like the webhooks
// fan-out tests. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+telegram-commands-test@anynote.dev'

// The dev DB is shared across worktrees and TelegramUserLink.telegramUserId /
// TelegramChat chat ids are globally unique-ish — derive run-unique numbers.
const RUN = Date.now()
const TG_CHAT = RUN // chat with a TEAM-collection subscription
const TG_CHAT_EMPTY = RUN + 1 // registered chat with ZERO subscriptions
const TG_UID_MEMBER = RUN + 2 // linked + workspace member
const TG_UID_STRANGER = RUN + 3 // linked but NOT a member of the workspace
const TG_UID_UNLINKED = RUN + 4 // no TelegramUserLink row
const TG_UID_NEW = RUN + 5 // fresh sender used by the /link tests

async function cleanFixtures() {
  const workspaces = await prisma.workspace.findMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
    select: { id: true },
  })
  const wsIds = workspaces.map((w) => w.id)
  // Connection delete cascades chats, subscriptions, deliveries and audits.
  await prisma.telegramConnection.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.telegramUserLink.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.telegramLinkCode.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.page.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.collection.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

async function makePage(args: {
  wsId: string
  collectionId: string
  title: string
  createdById: string
  parentId?: string
  type?: 'TEXT' | 'DATABASE'
  deletedAt?: Date
  archivedAt?: Date
}) {
  return prisma.page.create({
    data: {
      workspaceId: args.wsId,
      collectionId: args.collectionId,
      parentId: args.parentId ?? null,
      type: args.type ?? 'TEXT',
      title: args.title,
      createdById: args.createdById,
      deletedAt: args.deletedAt ?? null,
      archivedAt: args.archivedAt ?? null,
    },
    select: { id: true },
  })
}

// Seed: owner(OWNER) + member(EDITOR) + stranger (no membership), one TEAM
// collection subscribed to TG_CHAT, one unsubscribed SITE collection, one
// PERSONAL collection — each with a 'roadmap' page — plus trashed / archived /
// database-item pages inside the SUBSCRIBED collection.
async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const stranger = await makeUser('stranger')
  const ws = await prisma.workspace.create({
    data: { name: 'TelegramCommandsWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  // Only ONE owner-less TEAM collection may exist per workspace (partial unique
  // index `collections_one_team_per_workspace`) — a SITE collection is the
  // realistic same-workspace "other collection" that is never subscribed.
  const unsubscribed = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.SITE, title: 'Сайт' },
    select: { id: true },
  })
  const personal = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.PERSONAL, title: 'Личное', ownerId: owner.id },
    select: { id: true },
  })

  const teamPage = await makePage({
    wsId: ws.id,
    collectionId: team.id,
    title: 'Roadmap 2026',
    createdById: owner.id,
  })
  const trashedPage = await makePage({
    wsId: ws.id,
    collectionId: team.id,
    title: 'Roadmap trashed',
    createdById: owner.id,
    deletedAt: new Date(),
  })
  await makePage({
    wsId: ws.id,
    collectionId: team.id,
    title: 'Roadmap archived',
    createdById: owner.id,
    archivedAt: new Date(),
  })
  const databasePage = await makePage({
    wsId: ws.id,
    collectionId: team.id,
    title: 'Roadmap database',
    createdById: owner.id,
    type: 'DATABASE',
  })
  await makePage({
    wsId: ws.id,
    collectionId: team.id,
    title: 'Roadmap item row',
    createdById: owner.id,
    parentId: databasePage.id,
  })
  const unsubscribedPage = await makePage({
    wsId: ws.id,
    collectionId: unsubscribed.id,
    title: 'Roadmap unsubscribed',
    createdById: owner.id,
  })
  await makePage({
    wsId: ws.id,
    collectionId: personal.id,
    title: 'Roadmap personal',
    createdById: owner.id,
  })

  const connection = await prisma.telegramConnection.create({
    data: {
      workspaceId: ws.id,
      createdById: owner.id,
      botTokenEnc: encryptSecret(
        '123456789:AAFakeTokenForTests_abcdefghij',
      ) as Prisma.InputJsonValue,
      webhookSecretEnc: encryptSecret('tg-secret-test') as Prisma.InputJsonValue,
      status: 'ACTIVE',
    },
  })
  const chat = await prisma.telegramChat.create({
    data: {
      connectionId: connection.id,
      chatId: String(TG_CHAT),
      type: 'group',
      title: 'Dev chat',
    },
    select: { id: true },
  })
  await prisma.telegramChat.create({
    data: {
      connectionId: connection.id,
      chatId: String(TG_CHAT_EMPTY),
      type: 'group',
      title: 'Empty chat',
    },
  })
  await prisma.telegramCollectionSubscription.create({
    data: {
      connectionId: connection.id,
      chatId: chat.id,
      collectionId: team.id,
      events: ['page.created'],
      createdById: owner.id,
    },
  })
  await prisma.telegramUserLink.create({
    data: { userId: member.id, telegramUserId: String(TG_UID_MEMBER), username: 'member_tg' },
  })
  await prisma.telegramUserLink.create({
    data: { userId: stranger.id, telegramUserId: String(TG_UID_STRANGER), username: 'stranger_tg' },
  })

  return {
    ownerId: owner.id,
    memberId: member.id,
    strangerId: stranger.id,
    wsId: ws.id,
    teamCollectionId: team.id,
    teamPageId: teamPage.id,
    trashedPageId: trashedPage.id,
    unsubscribedPageId: unsubscribedPage.id,
    connection,
  }
}

function msg(text: string, opts: { chat?: number; from?: number } = {}): TelegramUpdate {
  return {
    message: {
      chat: { id: opts.chat ?? TG_CHAT, type: 'group', title: 'Dev chat' },
      from: { id: opts.from ?? TG_UID_MEMBER, username: 'sender_tg' },
      text,
    },
  }
}

async function makeLinkCode(userId: string, opts: { expiresAt?: Date; usedAt?: Date } = {}) {
  const code = generateLinkCode()
  await prisma.telegramLinkCode.create({
    data: {
      userId,
      codeHash: hashLinkCode(code),
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 15 * 60_000),
      usedAt: opts.usedAt ?? null,
    },
  })
  return code
}

const BASE_URL = () => (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')

describe('routeUpdate (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  // ── 1. /help ──────────────────────────────────────────────────────────────
  it('replies to /help with the command list and audits OK — no linking required', async () => {
    const fx = await seed()
    const res = await routeUpdate(prisma, fx.connection, msg('/help', { from: TG_UID_UNLINKED }))

    expect(res.reply).toBe(renderHelp())
    expect(res.reply).toContain('/search')
    expect(res.reply).toContain('/link')
    expect(res.audit).toMatchObject({
      command: 'help',
      result: 'OK',
      telegramUserId: String(TG_UID_UNLINKED),
      linkedUserId: null,
      chatId: String(TG_CHAT),
    })
  })

  // ── 2. /link lifecycle ────────────────────────────────────────────────────
  it('links a valid code (replacing the previous link), marks it used; expired/used/unknown are DENIED with distinct detail but identical reply', async () => {
    const fx = await seed()
    const linkme = await makeUser('linkme')
    // Pre-existing link for the same user — /link must REPLACE it, not error.
    await prisma.telegramUserLink.create({
      data: { userId: linkme.id, telegramUserId: String(RUN + 100), username: 'old_tg' },
    })
    const valid = await makeLinkCode(linkme.id)

    const ok = await routeUpdate(prisma, fx.connection, msg(`/link ${valid}`, { from: TG_UID_NEW }))
    expect(ok.audit).toMatchObject({ command: 'link', result: 'OK', linkedUserId: linkme.id })
    expect(ok.reply).toBe(renderLinkSuccess())

    const links = await prisma.telegramUserLink.findMany({ where: { userId: linkme.id } })
    expect(links).toHaveLength(1)
    expect(links[0]!.telegramUserId).toBe(String(TG_UID_NEW))
    const codeRow = await prisma.telegramLinkCode.findUnique({
      where: { codeHash: hashLinkCode(valid) },
    })
    expect(codeRow!.usedAt).not.toBeNull()

    // The plaintext code must never land in the audit args (codes are hashed at rest).
    expect(ok.audit!.argsSummary ?? '').not.toContain(valid)

    // Re-using the just-consumed code → DENIED (used).
    const used = await routeUpdate(
      prisma,
      fx.connection,
      msg(`/link ${valid}`, { from: TG_UID_NEW }),
    )
    const expired = await routeUpdate(
      prisma,
      fx.connection,
      msg(`/link ${await makeLinkCode(linkme.id, { expiresAt: new Date(Date.now() - 1000) })}`, {
        from: TG_UID_NEW,
      }),
    )
    const unknown = await routeUpdate(
      prisma,
      fx.connection,
      msg('/link WRONGC0D', { from: TG_UID_NEW }),
    )

    for (const denied of [used, expired, unknown]) {
      expect(denied.audit).toMatchObject({ command: 'link', result: 'DENIED' })
    }
    const details = [used.audit!.detail, expired.audit!.detail, unknown.audit!.detail]
    expect(new Set(details).size).toBe(3) // distinct audit details…
    // …but byte-identical user-facing replies — no oracle over code state.
    expect(unknown.reply).toBe(renderLinkInvalid())
    expect(used.reply).toBe(unknown.reply)
    expect(expired.reply).toBe(unknown.reply)
  })

  // ── 2b. /link must not steal an already-bound Telegram account ────────────
  it('denies /link when the Telegram account is already bound to ANOTHER user — link unchanged, code unconsumed, reply identical to other denials', async () => {
    const fx = await seed()
    // TG_UID_MEMBER is bound to `member`; `owner` issues a perfectly VALID code.
    const code = await makeLinkCode(fx.ownerId)

    const res = await routeUpdate(
      prisma,
      fx.connection,
      msg(`/link ${code}`, { from: TG_UID_MEMBER }),
    )

    // Byte-identical to the unknown/used/expired denials — no oracle over WHY.
    expect(res.reply).toBe(renderLinkInvalid())
    expect(res.audit).toMatchObject({
      command: 'link',
      result: 'DENIED',
      detail: 'telegram-already-linked',
      telegramUserId: String(TG_UID_MEMBER),
      linkedUserId: fx.memberId,
    })

    // member's binding is UNCHANGED — no silent steal.
    const memberLink = await prisma.telegramUserLink.findUniqueOrThrow({
      where: { telegramUserId: String(TG_UID_MEMBER) },
    })
    expect(memberLink.userId).toBe(fx.memberId)
    // owner gained no link, and the valid code was NOT consumed.
    expect(await prisma.telegramUserLink.findUnique({ where: { userId: fx.ownerId } })).toBeNull()
    const codeRow = await prisma.telegramLinkCode.findUniqueOrThrow({
      where: { codeHash: hashLinkCode(code) },
    })
    expect(codeRow.usedAt).toBeNull()
  })

  // ── 3. /search unlinked ───────────────────────────────────────────────────
  it('denies /search for an unlinked sender with the not-linked reply', async () => {
    const fx = await seed()
    const res = await routeUpdate(
      prisma,
      fx.connection,
      msg('/search roadmap', { from: TG_UID_UNLINKED }),
    )

    expect(res.reply).toBe(renderNotLinked())
    expect(res.audit).toMatchObject({
      command: 'search',
      result: 'DENIED',
      detail: 'not-linked',
      linkedUserId: null,
    })
  })

  // ── 4. /search linked non-member ──────────────────────────────────────────
  it('denies /search for a linked sender who is not a member of the connection workspace', async () => {
    const fx = await seed()
    const res = await routeUpdate(
      prisma,
      fx.connection,
      msg('/search roadmap', { from: TG_UID_STRANGER }),
    )

    expect(res.reply).toBe(renderDenied())
    expect(res.audit).toMatchObject({
      command: 'search',
      result: 'DENIED',
      detail: 'not-member',
      linkedUserId: fx.strangerId,
    })
  })

  // ── 5. /search scope + exclusions + top 5 ─────────────────────────────────
  it('searches only subscribed collections, case-insensitively, excluding trashed/archived/database-item pages, top 5', async () => {
    const fx = await seed()
    const res = await routeUpdate(prisma, fx.connection, msg('/search ROADMAP'))

    expect(res.audit).toMatchObject({ command: 'search', result: 'OK' })
    expect(res.reply).toContain('Roadmap 2026')
    expect(res.reply).toContain(`${BASE_URL()}/pages/${fx.teamPageId}`)
    expect(res.reply).not.toContain('Roadmap trashed')
    expect(res.reply).not.toContain('Roadmap archived')
    expect(res.reply).not.toContain('Roadmap item row')
    expect(res.reply).not.toContain('Roadmap unsubscribed')
    // The DATABASE page itself is a root-level page — visible (root-page bug guard).
    expect(res.reply).toContain('Roadmap database')

    // Top 5: flood the subscribed collection and count result lines.
    for (let i = 0; i < 7; i++) {
      await makePage({
        wsId: fx.wsId,
        collectionId: fx.teamCollectionId,
        title: `Roadmap bulk ${i}`,
        createdById: fx.ownerId,
      })
    }
    const flooded = await routeUpdate(prisma, fx.connection, msg('/search roadmap'))
    expect(flooded.reply!.match(/<a href=/g)).toHaveLength(5)
  })

  // ── 6. PERSONAL collection never searchable ───────────────────────────────
  it('never returns pages from PERSONAL collections — only TEAM subscriptions exist', async () => {
    const fx = await seed()
    const res = await routeUpdate(prisma, fx.connection, msg('/search roadmap'))

    expect(res.audit).toMatchObject({ command: 'search', result: 'OK' })
    expect(res.reply).not.toContain('Roadmap personal')
  })

  // ── 7. /search with zero subscriptions ────────────────────────────────────
  it('replies with the empty-scope message in a chat without subscriptions', async () => {
    const fx = await seed()
    const res = await routeUpdate(
      prisma,
      fx.connection,
      msg('/search roadmap', { chat: TG_CHAT_EMPTY }),
    )

    expect(res.reply).toBe(renderEmptyScope())
    expect(res.audit).toMatchObject({ command: 'search', result: 'OK', detail: 'no-scope' })
  })

  // ── 8. /get scope + uniform not-found oracle ──────────────────────────────
  it('returns title+link+updatedAt for an in-scope /get; malformed/nonexistent/out-of-scope/trashed are byte-identical not-found; unlinked is DENIED', async () => {
    const fx = await seed()

    const ok = await routeUpdate(prisma, fx.connection, msg(`/get ${fx.teamPageId}`))
    expect(ok.audit).toMatchObject({ command: 'get', result: 'OK' })
    expect(ok.reply).toContain('Roadmap 2026')
    expect(ok.reply).toContain(`${BASE_URL()}/pages/${fx.teamPageId}`)
    expect(ok.reply).toContain('Обновлена')

    const malformed = await routeUpdate(prisma, fx.connection, msg('/get not-a-uuid'))
    const nonexistent = await routeUpdate(prisma, fx.connection, msg(`/get ${randomUUID()}`))
    const outOfScope = await routeUpdate(
      prisma,
      fx.connection,
      msg(`/get ${fx.unsubscribedPageId}`),
    )
    const trashed = await routeUpdate(prisma, fx.connection, msg(`/get ${fx.trashedPageId}`))

    // Byte-identical across all four — no existence oracle.
    expect(malformed.reply).toBe(renderNotFound())
    expect(nonexistent.reply).toBe(renderNotFound())
    expect(outOfScope.reply).toBe(renderNotFound())
    expect(trashed.reply).toBe(renderNotFound())
    for (const res of [malformed, nonexistent, outOfScope, trashed]) {
      expect(res.audit).toMatchObject({ command: 'get' })
    }

    const unlinked = await routeUpdate(
      prisma,
      fx.connection,
      msg(`/get ${fx.teamPageId}`, { from: TG_UID_UNLINKED }),
    )
    expect(unlinked.reply).toBe(renderNotLinked())
    expect(unlinked.audit).toMatchObject({ command: 'get', result: 'DENIED', detail: 'not-linked' })
  })

  // ── 9. unknown command ────────────────────────────────────────────────────
  it('audits unknown commands and points at /help', async () => {
    const fx = await seed()
    const res = await routeUpdate(prisma, fx.connection, msg('/frobnicate now'))

    expect(res.reply).toContain('/help')
    expect(res.audit).toMatchObject({ command: 'unknown' })
    // A mistyped /link must not leak its argument (could be a live code).
    expect(res.audit!.argsSummary ?? '').not.toContain('now')
  })

  // ── 10. argsSummary truncation ────────────────────────────────────────────
  it('truncates argsSummary to 200 chars', async () => {
    const fx = await seed()
    const res = await routeUpdate(prisma, fx.connection, msg(`/search ${'x'.repeat(300)}`))

    expect(res.audit!.argsSummary).toHaveLength(200)
  })

  // ── 10b. /search query cap ────────────────────────────────────────────────
  it('caps a 10k-char /search query to 200 chars before it reaches Prisma contains', async () => {
    const fx = await seed()
    const longArg = 'x'.repeat(10_000)
    let capturedContains: string | undefined
    // routeUpdate takes prisma as a parameter — intercept page.findMany via a
    // wrapper instead of vi.spyOn: the shared client's delegates are
    // proxy-synthesized, so spies cannot call through them.
    const spyingPrisma = new Proxy(prisma, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown
        if (prop !== 'page') return value
        const page = value as typeof prisma.page
        return new Proxy(page, {
          get(pageTarget, method) {
            if (method !== 'findMany') return Reflect.get(pageTarget, method) as unknown
            return (args: { where?: { title?: { contains?: string } } }) => {
              capturedContains = args.where?.title?.contains
              return page.findMany(args as Parameters<typeof page.findMany>[0])
            }
          },
        })
      },
    }) as typeof prisma

    const res = await routeUpdate(spyingPrisma, fx.connection, msg(`/search ${longArg}`))

    // No error, a well-formed reply, and the audit summary stays truncated.
    expect(res.audit).toMatchObject({ command: 'search', result: 'OK' })
    expect(res.audit!.argsSummary).toHaveLength(200)
    expect(res.reply).toBe(renderSearchResults([]))

    // The string that reached Prisma `contains` is the CAPPED one.
    expect(capturedContains).toBe('x'.repeat(200))
  })

  // ── non-command messages produce neither reply nor audit ──────────────────
  it('ignores non-command text entirely (reply null, audit null)', async () => {
    const fx = await seed()
    const res = await routeUpdate(prisma, fx.connection, msg('просто сообщение'))

    expect(res).toEqual({ reply: null, audit: null })
  })
})
