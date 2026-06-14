import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { chatRouter } from '../src/routers/chat'
import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the Phase-9D ephemeral INLINE_AI chats. Two
// proofs:
//   (a) chat.listChats / listFavorites NEVER return INLINE_AI chats — they are
//       hidden ephemeral rows backing the in-editor inline AI.
//   (b) hard-deleting a page DELETES its INLINE_AI chats (not merely SetNull-
//       detaches them via the FK) — no orphaned ephemeral rows survive a purge.
// Self-contained (creates its own user / workspace / page / chats inline) so it
// passes on a fresh CI DB without seed data. Requires `docker compose up -d`.

const EMAIL_SUFFIX = '+chat-inline-ai-test@anynote.dev'

async function cleanFixtures() {
  // Chats first (they reference pages + users); then pages, members, workspaces, users.
  await prisma.chat.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspaceMember.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
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

function chatCaller(userId: string) {
  return createCallerFactory(chatRouter)({
    prisma,
    user: { id: userId, email: 'x', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  })
}

function pageCaller(userId: string) {
  return createCallerFactory(pageRouter)({
    prisma,
    user: { id: userId, email: 'x', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  })
}

// An OWNER + a workspace + a TEXT page created by the owner (so page hard-delete
// passes the ownership guard).
async function seed() {
  const owner = await makeUser('owner')
  const ws = await prisma.workspace.create({
    data: { name: 'InlineAiWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  const page = await prisma.page.create({
    data: { workspaceId: ws.id, type: 'TEXT', title: 'Page', createdById: owner.id },
    select: { id: true },
  })
  return { ownerId: owner.id, wsId: ws.id, pageId: page.id }
}

describe('inline-AI ephemeral chats (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('chat.listChats returns NORMAL chats and excludes INLINE_AI', async () => {
    const fx = await seed()
    const normal = await prisma.chat.create({
      data: { workspaceId: fx.wsId, createdById: fx.ownerId, title: 'Normal chat' },
      select: { id: true },
    })
    const inline = await prisma.chat.create({
      data: {
        workspaceId: fx.wsId,
        createdById: fx.ownerId,
        title: 'Inline AI',
        kind: 'INLINE_AI',
        inlineAiPageId: fx.pageId,
      },
      select: { id: true },
    })

    const chats = await chatCaller(fx.ownerId).listChats({ workspaceId: fx.wsId })
    const ids = chats.map((c) => c.id)
    expect(ids).toContain(normal.id)
    expect(ids).not.toContain(inline.id)
  })

  it('chat.listFavorites excludes a favourited INLINE_AI chat', async () => {
    const fx = await seed()
    const normal = await prisma.chat.create({
      data: { workspaceId: fx.wsId, createdById: fx.ownerId, title: 'Normal chat' },
      select: { id: true },
    })
    const inline = await prisma.chat.create({
      data: {
        workspaceId: fx.wsId,
        createdById: fx.ownerId,
        title: 'Inline AI',
        kind: 'INLINE_AI',
        inlineAiPageId: fx.pageId,
      },
      select: { id: true },
    })
    await prisma.favoriteChat.createMany({
      data: [
        { userId: fx.ownerId, chatId: normal.id },
        { userId: fx.ownerId, chatId: inline.id },
      ],
    })

    const favs = await chatCaller(fx.ownerId).listFavorites({ workspaceId: fx.wsId })
    const ids = favs.map((c) => c.id)
    expect(ids).toContain(normal.id)
    expect(ids).not.toContain(inline.id)
  })

  it('page hard-delete DELETES the page INLINE_AI chats (not just SetNull-detaches)', async () => {
    const fx = await seed()
    const inline = await prisma.chat.create({
      data: {
        workspaceId: fx.wsId,
        createdById: fx.ownerId,
        title: 'Inline AI',
        kind: 'INLINE_AI',
        inlineAiPageId: fx.pageId,
      },
      select: { id: true },
    })
    // Keep a NORMAL chat to prove the prune is scoped to INLINE_AI only.
    const normal = await prisma.chat.create({
      data: { workspaceId: fx.wsId, createdById: fx.ownerId, title: 'Normal chat' },
      select: { id: true },
    })

    // hard-delete is only reachable from the trash → soft-delete first.
    await pageCaller(fx.ownerId).softDelete({ id: fx.pageId, workspaceId: fx.wsId })
    await pageCaller(fx.ownerId).hardDelete({ id: fx.pageId, workspaceId: fx.wsId })

    // The INLINE_AI chat row must be GONE, not merely detached (inlineAiPageId nulled).
    const inlineAfter = await prisma.chat.findUnique({ where: { id: inline.id } })
    expect(inlineAfter).toBeNull()
    // The NORMAL chat is untouched.
    const normalAfter = await prisma.chat.findUnique({ where: { id: normal.id } })
    expect(normalAfter).not.toBeNull()
  })
})
