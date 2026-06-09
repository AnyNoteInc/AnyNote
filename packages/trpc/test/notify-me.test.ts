import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { notificationRouter } from '../src/routers/notification'
import { commentRouter } from '../src/routers/comment'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the "Notify me" page-notification preferences
// (set/get/clear) and the comment-reply / all-comments notification triggers.
// Self-cleaning via an email-suffix namespace; requires `docker compose up -d`.

const EMAIL_SUFFIX = '+notify-me-test@anynote.dev'

async function cleanFixtures() {
  await prisma.notificationInApp.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.notificationDelivery.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.notificationEvent.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.pageNotificationPreference.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.pageComment.deleteMany({
    where: { thread: { page: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } } },
  })
  await prisma.pageCommentThread.deleteMany({
    where: { page: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
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

function notifCaller(userId: string) {
  return createCallerFactory(notificationRouter)(makeCtx(userId))
}
function commentCaller(userId: string) {
  return createCallerFactory(commentRouter)(makeCtx(userId))
}
function makeCtx(userId: string) {
  return {
    prisma,
    user: {
      id: userId,
      email: 'x',
      firstName: 'T',
      lastName: 'U',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

// owner (OWNER, page creator) + a member (EDITOR) + a TEXT page.
async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const ws = await prisma.workspace.create({
    data: { name: 'NotifyWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  const page = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Notify page',
      createdById: owner.id,
    },
    select: { id: true },
  })
  return { owner, member, wsId: ws.id, pageId: page.id }
}

async function inAppFor(userId: string, type: string) {
  return prisma.notificationInApp.findMany({
    where: { userId, event: { type: type as never } },
    include: { event: true },
  })
}

describe('notify-me page preferences', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('set / get / clear a page notification preference', async () => {
    const fx = await seed()
    const c = notifCaller(fx.member.id)

    expect(await c.getPageNotificationPreference({ pageId: fx.pageId })).toEqual({ level: null })

    await c.setPageNotificationPreference({ pageId: fx.pageId, level: 'ALL_COMMENTS' })
    expect(await c.getPageNotificationPreference({ pageId: fx.pageId })).toEqual({
      level: 'ALL_COMMENTS',
    })

    // Updating the level overwrites (unique on userId+pageId).
    await c.setPageNotificationPreference({ pageId: fx.pageId, level: 'ALL_UPDATES' })
    expect(await c.getPageNotificationPreference({ pageId: fx.pageId })).toEqual({
      level: 'ALL_UPDATES',
    })

    await c.clearPageNotificationPreference({ pageId: fx.pageId })
    expect(await c.getPageNotificationPreference({ pageId: fx.pageId })).toEqual({ level: null })
  })

  it('a non-member cannot set a preference (NOT_FOUND / FORBIDDEN)', async () => {
    const fx = await seed()
    const stranger = await makeUser('stranger')
    await expect(
      notifCaller(stranger.id).setPageNotificationPreference({
        pageId: fx.pageId,
        level: 'ALL_COMMENTS',
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) })
  })
})

describe('comment notification triggers', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('a reply to an existing thread notifies a previous thread participant (COMMENT_REPLY)', async () => {
    const fx = await seed()
    // owner starts a thread; member replies → owner gets a COMMENT_REPLY.
    const thread = await commentCaller(fx.owner.id).createThread({
      pageId: fx.pageId,
      anchorStart: 'a',
      anchorEnd: 'b',
      quotedText: 'q',
      content: { text: 'first', mentions: [] },
    })
    await commentCaller(fx.member.id).addComment({
      pageId: fx.pageId,
      threadId: thread!.id,
      content: { text: 'reply', mentions: [] },
    })
    const replies = await inAppFor(fx.owner.id, 'COMMENT_REPLY')
    expect(replies.length).toBe(1)
  })

  it('a user with an ALL_COMMENTS pref gets a comment notification on any new comment', async () => {
    const fx = await seed()
    // member opts into ALL_COMMENTS; owner posts a brand-new thread → member is notified.
    await notifCaller(fx.member.id).setPageNotificationPreference({
      pageId: fx.pageId,
      level: 'ALL_COMMENTS',
    })
    await commentCaller(fx.owner.id).createThread({
      pageId: fx.pageId,
      anchorStart: 'a',
      anchorEnd: 'b',
      quotedText: 'q',
      content: { text: 'hello team', mentions: [] },
    })
    const got = await inAppFor(fx.member.id, 'COMMENT_CREATED')
    expect(got.length).toBe(1)
  })

  it('clearing the pref stops pref-driven notifications, but a direct @mention still notifies', async () => {
    const fx = await seed()
    await notifCaller(fx.member.id).setPageNotificationPreference({
      pageId: fx.pageId,
      level: 'ALL_COMMENTS',
    })
    await notifCaller(fx.member.id).clearPageNotificationPreference({ pageId: fx.pageId })

    // owner posts a thread that @mentions member → member still gets a PAGE_MENTION,
    // and NOT a pref-driven COMMENT_CREATED (the mention path covers them).
    await commentCaller(fx.owner.id).createThread({
      pageId: fx.pageId,
      anchorStart: 'a',
      anchorEnd: 'b',
      quotedText: 'q',
      content: { text: 'hey @member', mentions: [fx.member.id] },
    })
    const mentions = await inAppFor(fx.member.id, 'PAGE_MENTION')
    expect(mentions.length).toBe(1)
    const comments = await inAppFor(fx.member.id, 'COMMENT_CREATED')
    expect(comments.length).toBe(0)
  })

  it('the actor does not notify self (no self comment notification)', async () => {
    const fx = await seed()
    // owner opts into ALL_COMMENTS, then posts their own comment → no self-notify.
    await notifCaller(fx.owner.id).setPageNotificationPreference({
      pageId: fx.pageId,
      level: 'ALL_COMMENTS',
    })
    await commentCaller(fx.owner.id).createThread({
      pageId: fx.pageId,
      anchorStart: 'a',
      anchorEnd: 'b',
      quotedText: 'q',
      content: { text: 'mine', mentions: [] },
    })
    const got = await inAppFor(fx.owner.id, 'COMMENT_CREATED')
    expect(got.length).toBe(0)
  })
})
