import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@repo/db'

import { assertWorkspaceMember, assertRole } from '../src/helpers/workspace'
import {
  assertWorkspaceMember as assertWorkspaceMemberPageAccess,
  assertPageAccess,
} from '../src/helpers/page-access'
import { resolveActiveWorkspace } from '../src/helpers/active-workspace'
import { workspaceRouter } from '../src/routers/workspace'
import { fileRouter } from '../src/routers/file'
import { createCallerFactory } from '../src/trpc'

const EMAIL_SUFFIX = '+wsblock-test@anynote.dev'
const BLOCKED_MESSAGE = 'Доступ заблокирован администратором'

let ownerId: string
let blockedId: string
let outsiderId: string
let workspaceId: string
let pageId: string

async function cleanFixtures() {
  await prisma.userPreference.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

beforeAll(async () => {
  await cleanFixtures()
  const mk = (label: string) =>
    prisma.user.create({
      data: {
        email: `${label}${EMAIL_SUFFIX}`,
        emailVerified: true,
        name: label,
        firstName: label,
        lastName: 'Test',
      },
      select: { id: true },
    })
  const [owner, blocked, outsider] = await Promise.all([mk('owner'), mk('blocked'), mk('out')])
  ownerId = owner.id
  blockedId = blocked.id
  outsiderId = outsider.id

  const ws = await prisma.workspace.create({
    data: {
      name: 'Block WS',
      createdById: ownerId,
      members: {
        create: [
          { userId: ownerId, role: 'OWNER' },
          { userId: blockedId, role: 'EDITOR' },
        ],
      },
      blockedUsers: { create: [{ userId: blockedId, blockedById: ownerId }] },
    },
    select: { id: true },
  })
  workspaceId = ws.id

  const page = await prisma.page.create({
    data: { workspaceId, title: 'Page', type: 'TEXT', createdById: ownerId },
    select: { id: true },
  })
  pageId = page.id
})

afterAll(cleanFixtures)

function ctxFor(userId: string) {
  return {
    prisma,
    user: { id: userId },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  } as never
}

describe('blocked-user denial — trpc helpers', () => {
  it('assertWorkspaceMember (domain-backed) rejects a blocked member', async () => {
    await expect(assertWorkspaceMember(ctxFor(blockedId), workspaceId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: BLOCKED_MESSAGE,
    })
    await expect(assertWorkspaceMember(ctxFor(ownerId), workspaceId)).resolves.toMatchObject({
      role: 'OWNER',
    })
  })

  it('assertRole rejects a blocked member even when the role matches', async () => {
    await expect(
      assertRole(ctxFor(blockedId), workspaceId, ['OWNER', 'ADMIN', 'EDITOR']),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: BLOCKED_MESSAGE })
    await expect(
      assertRole(ctxFor(ownerId), workspaceId, ['OWNER', 'ADMIN']),
    ).resolves.toMatchObject({ role: 'OWNER' })
    await expect(assertRole(ctxFor(outsiderId), workspaceId, ['OWNER'])).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Недостаточно прав',
    })
  })

  it('page-access assertWorkspaceMember rejects a blocked member', async () => {
    await expect(
      assertWorkspaceMemberPageAccess(ctxFor(blockedId), workspaceId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: BLOCKED_MESSAGE })
    await expect(
      assertWorkspaceMemberPageAccess(ctxFor(ownerId), workspaceId),
    ).resolves.toMatchObject({ role: 'OWNER' })
  })

  it('page-access assertPageAccess denies a blocked member (uniform NOT_FOUND)', async () => {
    await expect(assertPageAccess(ctxFor(blockedId), pageId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(assertPageAccess(ctxFor(ownerId), pageId)).resolves.toMatchObject({ id: pageId })
  })

  it('resolveActiveWorkspace skips a workspace the user is blocked in', async () => {
    await prisma.userPreference.upsert({
      where: { userId: blockedId },
      create: { userId: blockedId, activeWorkspaceId: workspaceId },
      update: { activeWorkspaceId: workspaceId },
    })
    const ws = await resolveActiveWorkspace(prisma, blockedId)
    expect(ws?.id).not.toBe(workspaceId)
  })
})

describe('blocked-user denial — router sample', () => {
  it('workspace.listMembers is FORBIDDEN for a blocked member', async () => {
    const caller = createCallerFactory(workspaceRouter)(ctxFor(blockedId))
    await expect(caller.listMembers({ workspaceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: BLOCKED_MESSAGE,
    })
  })

  it('workspace.setActive is FORBIDDEN for a blocked member', async () => {
    const caller = createCallerFactory(workspaceRouter)(ctxFor(blockedId))
    await expect(caller.setActive({ workspaceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: BLOCKED_MESSAGE,
    })
  })

  it('workspace.getMyRole returns null for a blocked member', async () => {
    const caller = createCallerFactory(workspaceRouter)(ctxFor(blockedId))
    await expect(caller.getMyRole({ workspaceId })).resolves.toBeNull()
  })

  it('workspace.getById returns null for a blocked member (uniform miss)', async () => {
    const blockedCaller = createCallerFactory(workspaceRouter)(ctxFor(blockedId))
    await expect(blockedCaller.getById({ id: workspaceId })).resolves.toBeNull()
    // sanity: the block filter does not hide the workspace from a regular member
    const ownerCaller = createCallerFactory(workspaceRouter)(ctxFor(ownerId))
    await expect(ownerCaller.getById({ id: workspaceId })).resolves.toMatchObject({
      id: workspaceId,
    })
  })

  it('file.listRecent is FORBIDDEN for a blocked member', async () => {
    const caller = createCallerFactory(fileRouter)(ctxFor(blockedId))
    await expect(caller.listRecent({ workspaceId, limit: 5 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: BLOCKED_MESSAGE,
    })
  })
})
