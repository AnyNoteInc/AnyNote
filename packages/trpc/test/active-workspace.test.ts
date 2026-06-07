import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { resolveActiveWorkspace } from '../src/helpers/active-workspace'

const EMAIL_SUFFIX = '+activews-test@anynote.dev'

async function cleanFixtures() {
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
