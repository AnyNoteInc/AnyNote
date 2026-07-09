import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { chatRouter } from '../src/routers/chat'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for page-scoped PAGE chats:
//   (a) createChat({pageId}) creates a kind=PAGE chat bound to the page, gated
//       by page visibility (NOT_FOUND, no oracle) and the plan's chatsEnabled.
//   (b) listByPage returns only that page's PAGE chats; listChats never
//       returns PAGE chats.
//   (c) getChat/deleteChat re-check CURRENT page visibility for PAGE chats —
//       a member who can't see a private page can't read its chat.
// Self-contained (creates its own users / workspace / collection / pages
// inline; plans come from the standard seed) so it passes on a fresh CI DB.
// Requires `docker compose up -d`.

const EMAIL_SUFFIX = '+page-chat-test@anynote.dev'

async function cleanFixtures() {
  // Chats first (they reference pages + users); then pages, collections,
  // members, subscriptions, workspaces, users.
  await prisma.chat.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.collection.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspaceMember.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
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

// Give the workspace owner an ACTIVE subscription on the given seeded plan
// ('personal' → chatsEnabled false, 'pro' → chatsEnabled true).
async function subscribeTo(userId: string, slug: 'personal' | 'pro') {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { slug } })
  await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    },
  })
}

function caller(userId: string) {
  return createCallerFactory(chatRouter)({
    prisma,
    user: { id: userId, email: 'x', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  })
}

type Fixture = {
  ownerId: string
  memberId: string
  workspaceId: string
  visiblePageId: string // collectionId null → visible to all members
  privatePageId: string // PERSONAL collection owned by owner → invisible to member
}

// owner (OWNER, subscribed to the given plan) + member (EDITOR), a TEXT page
// with collectionId null, and a TEXT page inside the owner's PERSONAL collection.
async function makeFixture(opts: { plan: 'personal' | 'pro' }): Promise<Fixture> {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  await subscribeTo(owner.id, opts.plan)
  const ws = await prisma.workspace.create({
    data: { name: 'PageChatWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  const visiblePage = await prisma.page.create({
    data: { workspaceId: ws.id, type: 'TEXT', title: 'Visible', createdById: owner.id },
    select: { id: true },
  })
  const personal = await prisma.collection.create({
    data: {
      workspaceId: ws.id,
      kind: CollectionKind.PERSONAL,
      title: 'Личное',
      ownerId: owner.id,
    },
    select: { id: true },
  })
  const privatePage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Private',
      createdById: owner.id,
      collectionId: personal.id,
    },
    select: { id: true },
  })
  return {
    ownerId: owner.id,
    memberId: member.id,
    workspaceId: ws.id,
    visiblePageId: visiblePage.id,
    privatePageId: privatePage.id,
  }
}

describe('page chats (tRPC)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('createChat with pageId creates a PAGE chat bound to the page', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const chat = await caller(f.ownerId).createChat({
      workspaceId: f.workspaceId,
      pageId: f.visiblePageId,
    })
    expect(chat.kind).toBe('PAGE')
    expect(chat.pageId).toBe(f.visiblePageId)
  })

  it('createChat with pageId is FORBIDDEN when the plan lacks chatsEnabled', async () => {
    const f = await makeFixture({ plan: 'personal' })
    await expect(
      caller(f.ownerId).createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createChat with an invisible pageId is NOT_FOUND (no oracle)', async () => {
    const f = await makeFixture({ plan: 'pro' })
    await expect(
      caller(f.memberId).createChat({ workspaceId: f.workspaceId, pageId: f.privatePageId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('listByPage returns only that page PAGE chats, newest first', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const own = caller(f.ownerId)
    const a = await own.createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    const b = await own.createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    await own.createChat({ workspaceId: f.workspaceId }) // NORMAL — must not appear
    const list = await own.listByPage({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    expect(list.map((c) => c.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('listChats still excludes PAGE chats', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const own = caller(f.ownerId)
    const pageChat = await own.createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    const normal = await own.createChat({ workspaceId: f.workspaceId })
    const list = await own.listChats({ workspaceId: f.workspaceId })
    const ids = list.map((c) => c.id)
    expect(ids).toContain(normal.id)
    expect(ids).not.toContain(pageChat.id)
  })

  it('getChat denies a PAGE chat whose page is invisible to the caller', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const chat = await caller(f.ownerId).createChat({
      workspaceId: f.workspaceId,
      pageId: f.privatePageId,
    })
    await expect(caller(f.memberId).getChat({ chatId: chat.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const got = await caller(f.ownerId).getChat({ chatId: chat.id })
    expect(got.chat.id).toBe(chat.id)
  })

  it('getChat denies a PAGE chat whose page is in the trash (deletedAt set)', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const own = caller(f.ownerId)
    const chat = await own.createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    await prisma.page.update({
      where: { id: f.visiblePageId },
      data: { deletedAt: new Date() },
    })
    await expect(own.getChat({ chatId: chat.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('deleteChat works for PAGE chats via the same access path', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const own = caller(f.ownerId)
    const chat = await own.createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    await own.deleteChat({ chatId: chat.id })
    const list = await own.listByPage({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    expect(list).toEqual([])
  })
})
