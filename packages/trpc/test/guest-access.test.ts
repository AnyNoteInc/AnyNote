import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

process.env.BETTER_AUTH_URL ||= 'http://localhost:3000'

import { prisma } from '@repo/db'

import { pageRouter } from '../src/routers/page'
import { workspaceRouter } from '../src/routers/workspace'
import { peopleRouter } from '../src/routers/people'
import { commentRouter } from '../src/routers/comment'
import { resolveActiveWorkspace } from '../src/helpers/active-workspace'
import { assertWorkspaceMemberOrPageGrant } from '../src/helpers/page-access'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the Task 6 guest read-path: page reads and
// comments accept member-OR-grant (grant on the page or any ancestor), writes
// stay member-only, the switcher list flags grant-only workspaces, and blocked
// users are denied on every arm. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+guest-access-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)
const BLOCKED_MESSAGE = 'Доступ заблокирован администратором'

type FixtureUser = { id: string; email: string }

async function cleanFixtures() {
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  await prisma.notificationEvent.deleteMany({ where: byUser })
  await prisma.userPreference.deleteMany({ where: byUser })
  // Pages / shares / grants / blocks / members cascade with the workspace.
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeUser(label: string): Promise<FixtureUser> {
  return prisma.user.create({
    data: {
      email: `${label}-${RUN}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
    select: { id: true, email: true },
  })
}

async function ensurePersonalPlan() {
  await prisma.plan.upsert({
    where: { slug: 'personal' },
    update: {},
    create: { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
  })
}

async function makeWorkspace(ownerId: string, name: string) {
  const ws = await prisma.workspace.create({
    data: { name, createdById: ownerId },
    select: { id: true, name: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: ownerId, role: 'OWNER' },
  })
  return ws
}

async function makePage(
  workspaceId: string,
  createdById: string,
  title: string,
  parentId: string | null = null,
) {
  return prisma.page.create({
    data: { workspaceId, createdById, title, type: 'TEXT', parentId },
    select: { id: true, workspaceId: true },
  })
}

async function grantOn(pageId: string, userId: string, role: 'READER' | 'COMMENTER' | 'EDITOR') {
  const share = await prisma.pageShare.upsert({
    where: { pageId },
    create: { pageId, shareId: `ga-${RUN}-${randomUUID().slice(0, 13)}` },
    update: {},
    select: { id: true },
  })
  await prisma.pageShareUser.create({ data: { pageShareId: share.id, userId, role } })
}

async function blockUser(workspaceId: string, userId: string, blockedById: string) {
  await prisma.workspaceBlockedUser.create({ data: { workspaceId, userId, blockedById } })
}

function ctxFor(user: FixtureUser | null) {
  return {
    prisma,
    user: user
      ? { id: user.id, email: user.email, firstName: 'F', lastName: 'L', emailVerified: true }
      : null,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://app.test',
  } as never
}

const pages = (u: FixtureUser) => createCallerFactory(pageRouter)(ctxFor(u))
const workspaces = (u: FixtureUser) => createCallerFactory(workspaceRouter)(ctxFor(u))
const people = (u: FixtureUser) => createCallerFactory(peopleRouter)(ctxFor(u))
const comments = (u: FixtureUser) => createCallerFactory(commentRouter)(ctxFor(u))

/**
 * Standard topology: `guest` holds an EDITOR grant on `root` (only), inside
 * owner's workspace `ws`. `child` and `grandchild` hang under `root`;
 * `sibling` is ungranted. The guest also OWNS their own workspace `ownWs`.
 */
async function seed() {
  await ensurePersonalPlan()
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const guest = await makeUser('guest')
  const outsider = await makeUser('outsider')

  const ws = await makeWorkspace(owner.id, 'GuestAccessWS')
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
  })
  const ownWs = await makeWorkspace(guest.id, 'GuestOwnWS')

  const root = await makePage(ws.id, owner.id, 'Granted root')
  const child = await makePage(ws.id, owner.id, 'Child of granted', root.id)
  const grandchild = await makePage(ws.id, owner.id, 'Grandchild', child.id)
  const sibling = await makePage(ws.id, owner.id, 'Ungranted sibling')
  await grantOn(root.id, guest.id, 'EDITOR')

  return { owner, member, guest, outsider, ws, ownWs, root, child, grandchild, sibling }
}

describe('guest read-path (member-OR-grant)', () => {
  beforeEach(cleanFixtures)
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  describe('page.getById', () => {
    it('guest reads the directly granted page', async () => {
      const f = await seed()
      const page = await pages(f.guest).getById({ id: f.root.id })
      expect(page.id).toBe(f.root.id)
      expect(page.workspaceId).toBe(f.ws.id)
    })

    it('guest reads a descendant of the granted page (ancestor inheritance)', async () => {
      const f = await seed()
      const page = await pages(f.guest).getById({ id: f.grandchild.id })
      expect(page.id).toBe(f.grandchild.id)
    })

    it('guest is NOT_FOUND on an ungranted sibling', async () => {
      const f = await seed()
      await expect(pages(f.guest).getById({ id: f.sibling.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('outsider (no grant) stays NOT_FOUND — no existence oracle', async () => {
      const f = await seed()
      await expect(pages(f.outsider).getById({ id: f.root.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('guest cannot read a trashed page even under a granted root', async () => {
      const f = await seed()
      await prisma.page.update({
        where: { id: f.grandchild.id },
        data: { deletedAt: new Date() },
      })
      await expect(pages(f.guest).getById({ id: f.grandchild.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('member access is unaffected (regression)', async () => {
      const f = await seed()
      const page = await pages(f.member).getById({ id: f.sibling.id })
      expect(page.id).toBe(f.sibling.id)
    })

    it('blocked guest gets FORBIDDEN', async () => {
      const f = await seed()
      await blockUser(f.ws.id, f.guest.id, f.owner.id)
      await expect(pages(f.guest).getById({ id: f.root.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: BLOCKED_MESSAGE,
      })
    })

    it('blocked member gets FORBIDDEN', async () => {
      const f = await seed()
      await blockUser(f.ws.id, f.member.id, f.owner.id)
      await expect(pages(f.member).getById({ id: f.sibling.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: BLOCKED_MESSAGE,
      })
    })

    it('blocked outsider (no member, no grant) gets the same denial as a plain outsider — no blocked oracle', async () => {
      const f = await seed()
      await blockUser(f.ws.id, f.outsider.id, f.owner.id)
      // Page read keeps the object-hiding NOT_FOUND…
      await expect(pages(f.outsider).getById({ id: f.root.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      // …the page-scoped assert keeps the uniform outsider FORBIDDEN message…
      await expect(
        assertWorkspaceMemberOrPageGrant(ctxFor(f.outsider), f.ws.id, f.root.id),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      // …and so does the workspace-scoped surface (setActive). The blocked
      // message must never leak to users with no relationship at all.
      await expect(
        workspaces(f.outsider).setActive({ workspaceId: f.ws.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
    })
  })

  describe('writes stay member-only', () => {
    it('guest with an EDITOR grant is FORBIDDEN on page.rename', async () => {
      const f = await seed()
      await expect(
        pages(f.guest).rename({ id: f.root.id, workspaceId: f.ws.id, title: 'Hacked' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('guest with an EDITOR grant is FORBIDDEN on page.update', async () => {
      const f = await seed()
      await expect(
        pages(f.guest).update({ id: f.root.id, workspaceId: f.ws.id, title: 'Hacked' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('member rename still works (regression)', async () => {
      const f = await seed()
      // rename is creator-or-OWNER gated in the domain — use the member's own page.
      const own = await makePage(f.ws.id, f.member.id, 'Member page')
      const renamed = await pages(f.member).rename({
        id: own.id,
        workspaceId: f.ws.id,
        title: 'Renamed by member',
      })
      expect(renamed.title).toBe('Renamed by member')
    })
  })

  describe('people.myGrantedPages', () => {
    it('returns direct grants only — children reachable by navigation are not listed', async () => {
      const f = await seed()
      const list = await people(f.guest).myGrantedPages({ workspaceId: f.ws.id })
      expect(list).toEqual([
        { id: f.root.id, title: 'Granted root', icon: null, role: 'EDITOR' },
      ])
    })

    it('excludes deleted and archived granted pages', async () => {
      const f = await seed()
      const archived = await makePage(f.ws.id, f.owner.id, 'Archived granted')
      const deleted = await makePage(f.ws.id, f.owner.id, 'Deleted granted')
      await grantOn(archived.id, f.guest.id, 'READER')
      await grantOn(deleted.id, f.guest.id, 'READER')
      await prisma.page.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
      await prisma.page.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
      const list = await people(f.guest).myGrantedPages({ workspaceId: f.ws.id })
      expect(list.map((p) => p.id)).toEqual([f.root.id])
    })

    it('blocked guest is FORBIDDEN', async () => {
      const f = await seed()
      await blockUser(f.ws.id, f.guest.id, f.owner.id)
      await expect(people(f.guest).myGrantedPages({ workspaceId: f.ws.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: BLOCKED_MESSAGE,
      })
    })
  })

  describe('workspace.listMine accessKind', () => {
    it('guest sees the grant-only workspace flagged guest, own workspace flagged member', async () => {
      const f = await seed()
      const list = await workspaces(f.guest).listMine()
      const kinds = new Map(list.map((w) => [w.id, w.accessKind]))
      expect(kinds.get(f.ownWs.id)).toBe('member')
      expect(kinds.get(f.ws.id)).toBe('guest')
    })

    it('member workspaces are flagged member and carry no guest duplicates (regression)', async () => {
      const f = await seed()
      const list = await workspaces(f.owner).listMine()
      expect(list.filter((w) => w.id === f.ws.id)).toEqual([
        expect.objectContaining({ accessKind: 'member' }),
      ])
    })

    it('blocked guest no longer sees the workspace', async () => {
      const f = await seed()
      await blockUser(f.ws.id, f.guest.id, f.owner.id)
      const list = await workspaces(f.guest).listMine()
      expect(list.map((w) => w.id)).not.toContain(f.ws.id)
    })

    it('outsider does not see the workspace', async () => {
      const f = await seed()
      const list = await workspaces(f.outsider).listMine()
      expect(list.map((w) => w.id)).not.toContain(f.ws.id)
    })
  })

  describe('workspace.setActive + resolveActiveWorkspace for guests', () => {
    it('guest can select the grant-only workspace and the resolver honours it', async () => {
      const f = await seed()
      const ws = await workspaces(f.guest).setActive({ workspaceId: f.ws.id })
      expect(ws.id).toBe(f.ws.id)
      const resolved = await resolveActiveWorkspace(prisma, f.guest.id)
      expect(resolved?.id).toBe(f.ws.id)
    })

    it('outsider is FORBIDDEN on setActive', async () => {
      const f = await seed()
      await expect(
        workspaces(f.outsider).setActive({ workspaceId: f.ws.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
    })

    it('blocked guest is FORBIDDEN on setActive and the resolver falls back', async () => {
      const f = await seed()
      await blockUser(f.ws.id, f.guest.id, f.owner.id)
      await expect(workspaces(f.guest).setActive({ workspaceId: f.ws.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      await prisma.userPreference.upsert({
        where: { userId: f.guest.id },
        create: { userId: f.guest.id, activeWorkspaceId: f.ws.id },
        update: { activeWorkspaceId: f.ws.id },
      })
      const resolved = await resolveActiveWorkspace(prisma, f.guest.id)
      expect(resolved?.id).toBe(f.ownWs.id)
    })
  })

  describe('comments accept the grant with ancestor inheritance', () => {
    it('EDITOR-grant guest can create a thread on a descendant page', async () => {
      const f = await seed()
      const thread = await comments(f.guest).createThread({
        pageId: f.child.id,
        anchorStart: 'a',
        anchorEnd: 'b',
        quotedText: 'q',
        content: { text: 'guest comment', mentions: [] },
      })
      expect(thread?.id).toBeTruthy()
      const threads = await comments(f.guest).listThreads({ pageId: f.child.id })
      expect(threads.map((t) => t.id)).toContain(thread?.id)
    })

    it('READER-grant guest can list but not write', async () => {
      const f = await seed()
      const reader = await makeUser('reader')
      await grantOn(f.root.id, reader.id, 'READER')
      await expect(comments(reader).listThreads({ pageId: f.child.id })).resolves.toEqual([])
      await expect(
        comments(reader).createThread({
          pageId: f.child.id,
          anchorStart: 'a',
          anchorEnd: 'b',
          quotedText: 'q',
          content: { text: 'nope', mentions: [] },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('outsider stays FORBIDDEN on listThreads', async () => {
      const f = await seed()
      await expect(comments(f.outsider).listThreads({ pageId: f.child.id })).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      )
    })
  })
})
