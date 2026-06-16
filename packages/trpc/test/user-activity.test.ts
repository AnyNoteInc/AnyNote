import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { userRouter } from '../src/routers/user'
import { createCallerFactory } from '../src/trpc'

const EMAIL_SUFFIX = '+useractivity-test@anynote.dev'

async function cleanFixtures() {
  // PageRevisions cascade on page delete; delete pages by workspace owner suffix.
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.userPreference.deleteMany({
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
      lastName: 'T',
    },
  })
}

async function makeWorkspace(ownerId: string, name: string) {
  const ws = await prisma.workspace.create({ data: { name, createdById: ownerId } })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: ownerId, role: 'OWNER' },
  })
  return ws
}

async function makePage(
  workspaceId: string,
  createdById: string,
  title: string,
  opts: { deletedAt?: Date } = {},
) {
  return prisma.page.create({
    data: {
      workspaceId,
      createdById,
      type: 'TEXT',
      title,
      deletedAt: opts.deletedAt ?? null,
    },
  })
}

async function makeRevision(pageId: string, actorId: string, createdAt: Date) {
  return prisma.pageRevision.create({
    data: { pageId, actorId, action: 'EDIT', createdAt },
  })
}

function makeCaller(userId: string, email: string) {
  return createCallerFactory(userRouter)({
    prisma,
    user: { id: userId, email },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost:3000',
  })
}

describe('user.activity', () => {
  beforeEach(cleanFixtures)

  it('returns a per-day grid counting only the caller revisions', async () => {
    const user = await makeUser('grid')
    const other = await makeUser('grid-other')
    const ws = await makeWorkspace(user.id, 'WS')
    const page = await makePage(ws.id, user.id, 'Page')

    // 2 revisions on 2026-06-10, 1 on 2026-06-11 by the caller.
    await makeRevision(page.id, user.id, new Date('2026-06-10T10:00:00Z'))
    await makeRevision(page.id, user.id, new Date('2026-06-10T14:00:00Z'))
    await makeRevision(page.id, user.id, new Date('2026-06-11T09:00:00Z'))
    // 1 revision on 2026-06-10 by a DIFFERENT user — must be excluded.
    await makeRevision(page.id, other.id, new Date('2026-06-10T12:00:00Z'))

    const caller = makeCaller(user.id, user.email)
    const res = await caller.activity()

    const counts = new Map(res.grid.map((g) => [g.date, g.count]))
    expect(counts.get('2026-06-10')).toBe(2)
    expect(counts.get('2026-06-11')).toBe(1)
  })

  it('returns recentActions for the caller, most recent first, excluding others and soft-deleted pages', async () => {
    const user = await makeUser('recent')
    const other = await makeUser('recent-other')
    const ws = await makeWorkspace(user.id, 'WS')
    const page = await makePage(ws.id, user.id, 'Visible Page')
    const deletedPage = await makePage(ws.id, user.id, 'Deleted Page', {
      deletedAt: new Date('2026-06-12T00:00:00Z'),
    })

    await makeRevision(page.id, user.id, new Date('2026-06-10T10:00:00Z'))
    const newer = await makeRevision(page.id, user.id, new Date('2026-06-11T10:00:00Z'))
    // Other user's revision — must be excluded.
    await makeRevision(page.id, other.id, new Date('2026-06-13T10:00:00Z'))
    // Revision on a soft-deleted page — must be excluded.
    await makeRevision(deletedPage.id, user.id, new Date('2026-06-14T10:00:00Z'))

    const caller = makeCaller(user.id, user.email)
    const res = await caller.activity()

    // Caller has exactly 2 visible revisions, most recent first.
    expect(res.recentActions).toHaveLength(2)
    expect(res.recentActions[0].createdAt.getTime()).toBe(newer.createdAt.getTime())
    expect(res.recentActions[0].pageId).toBe(page.id)
    expect(res.recentActions[0].pageTitle).toBe('Visible Page')
    expect(res.recentActions[0].action).toBe('EDIT')

    const titles = res.recentActions.map((a) => a.pageTitle)
    expect(titles).not.toContain('Deleted Page')
    const pageIds = res.recentActions.map((a) => a.pageId)
    expect(pageIds).not.toContain(deletedPage.id)
  })

  it('excludes activity in a workspace the caller has LEFT (no cross-tenant leak)', async () => {
    const user = await makeUser('exmember')
    const ws = await makeWorkspace(user.id, 'WS')
    const page = await makePage(ws.id, user.id, 'Left Workspace Page')
    await makeRevision(page.id, user.id, new Date('2026-06-10T10:00:00Z'))

    const caller = makeCaller(user.id, user.email)

    // While a member, the activity is visible in both surfaces.
    const before = await caller.activity()
    const beforeCounts = new Map(before.grid.map((g) => [g.date, g.count]))
    expect(beforeCounts.get('2026-06-10')).toBe(1)
    expect(before.recentActions.map((a) => a.pageId)).toContain(page.id)

    // The user leaves (is removed from) the workspace.
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: ws.id, userId: user.id },
    })

    // Now the activity must NOT leak the workspace's page titles or edit counts.
    const after = await caller.activity()
    const afterCounts = new Map(after.grid.map((g) => [g.date, g.count]))
    expect(afterCounts.get('2026-06-10')).toBeUndefined()
    expect(after.recentActions.map((a) => a.pageId)).not.toContain(page.id)
    expect(after.recentActions.map((a) => a.pageTitle)).not.toContain('Left Workspace Page')
  })
})
