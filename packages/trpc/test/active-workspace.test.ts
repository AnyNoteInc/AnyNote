import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { resolveActiveWorkspace } from '../src/helpers/active-workspace'
import { workspaceRouter } from '../src/routers/workspace'
import { createCallerFactory } from '../src/trpc'

const EMAIL_SUFFIX = '+activews-test@anynote.dev'

async function cleanFixtures() {
  await prisma.userPreference.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
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

describe('resolveActiveWorkspace', () => {
  beforeEach(cleanFixtures)

  it('returns null when the user has no workspace', async () => {
    const user = await makeUser('none')
    expect(await resolveActiveWorkspace(prisma, user.id)).toBeNull()
  })

  it('returns the stored active workspace when still a member', async () => {
    const user = await makeUser('active')
    const ws = await makeWorkspace(user.id, 'A')
    await prisma.userPreference.create({
      data: { userId: user.id, activeWorkspaceId: ws.id },
    })
    const result = await resolveActiveWorkspace(prisma, user.id)
    expect(result?.id).toBe(ws.id)
  })

  it('falls back to defaultWorkspaceId and repairs active when active is stale', async () => {
    // "stale" = activeWorkspaceId points at a workspace the user is no longer a
    // member of. (A dangling id cannot occur: the activeWorkspaceId FK is
    // onDelete: SetNull, so a deleted workspace nulls the column rather than
    // leaving a dangling reference.) The workspace is owned by another user, so
    // it exists (satisfying the FK) but our user is not a member.
    const user = await makeUser('stale')
    const stranger = await makeUser('stale-stranger')
    const wsForeign = await makeWorkspace(stranger.id, 'F')
    const wsDefault = await makeWorkspace(user.id, 'D')
    await prisma.userPreference.create({
      data: {
        userId: user.id,
        defaultWorkspaceId: wsDefault.id,
        activeWorkspaceId: wsForeign.id,
      },
    })
    const result = await resolveActiveWorkspace(prisma, user.id)
    expect(result?.id).toBe(wsDefault.id)
    const pref = await prisma.userPreference.findUnique({ where: { userId: user.id } })
    expect(pref?.activeWorkspaceId).toBe(wsDefault.id)
  })

  it('falls back to the first workspace when no valid active or default', async () => {
    const user = await makeUser('first')
    const ws1 = await makeWorkspace(user.id, 'W1')
    await makeWorkspace(user.id, 'W2')
    const result = await resolveActiveWorkspace(prisma, user.id)
    expect(result?.id).toBe(ws1.id) // createdAt asc -> first created
    const pref = await prisma.userPreference.findUnique({ where: { userId: user.id } })
    expect(pref?.activeWorkspaceId).toBe(ws1.id)
  })
})

function makeCaller(userId: string, email: string) {
  return createCallerFactory(workspaceRouter)({
    prisma,
    user: { id: userId, email },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost:3000',
  })
}

describe('workspace.getActive / setActive', () => {
  beforeEach(cleanFixtures)

  it('setActive writes the pref for a member and getActive returns it', async () => {
    const user = await makeUser('setget')
    const ws = await makeWorkspace(user.id, 'WS')
    const caller = makeCaller(user.id, user.email)

    const set = await caller.setActive({ workspaceId: ws.id })
    expect(set.id).toBe(ws.id)

    const active = await caller.getActive()
    expect(active?.id).toBe(ws.id)
  })

  it('setActive rejects a non-member', async () => {
    const owner = await makeUser('owner')
    const ws = await makeWorkspace(owner.id, 'WS')
    const stranger = await makeUser('stranger')
    const caller = makeCaller(stranger.id, stranger.email)

    await expect(caller.setActive({ workspaceId: ws.id })).rejects.toThrow()
  })

  it('create sets the new workspace as active', async () => {
    const user = await makeUser('creator')
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    await prisma.subscription.create({
      data: { userId: user.id, planId: plan.id, status: 'ACTIVE' },
    })
    const caller = makeCaller(user.id, user.email)
    const ws = await caller.create({ name: 'New' })

    const pref = await prisma.userPreference.findUnique({ where: { userId: user.id } })
    expect(pref?.activeWorkspaceId).toBe(ws.id)
  })
})
