import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { workspaceRouter } from '../src/routers/workspace'
import { createCallerFactory } from '../src/trpc'

const EMAIL_SUFFIX = '+wsusage-test@anynote.dev'

async function cleanFixtures() {
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeOwnerWithSub(label: string, planSlug: 'personal' | 'pro' | 'max' = 'personal') {
  const owner = await prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'T',
    },
  })
  const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: planSlug } })
  await prisma.subscription.create({
    data: { userId: owner.id, planId: plan.id, status: 'ACTIVE' },
  })
  return owner
}

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

describe('workspace.getUsage', () => {
  beforeEach(cleanFixtures)

  it('returns limits, usage, and ownerPlanSlug for personal owner', async () => {
    const owner = await makeOwnerWithSub('o')
    const caller = makeCaller(owner.id, owner.email)
    const ws = await caller.create({ name: 'WS' })

    const result = await caller.getUsage({ workspaceId: ws.id })
    expect(result.limits.maxMembers).toBe(1)
    expect(result.limits.maxFileBytes).toBe('524288000')
    expect(result.usage.memberCount).toBe(1)
    expect(result.usage.fileBytesUsed).toBe('0')
    expect(result.ownerPlanSlug).toBe('personal')
  })

  it('reflects file usage from ACTIVE files only', async () => {
    const owner = await makeOwnerWithSub('f')
    const caller = makeCaller(owner.id, owner.email)
    const ws = await caller.create({ name: 'WS' })

    await prisma.file.create({
      data: {
        userId: owner.id,
        workspaceId: ws.id,
        name: 'a.txt',
        ext: 'txt',
        fileSize: 1000n,
        mimeType: 'text/plain',
        hash: 'h1',
        path: 'p1',
        status: 'ACTIVE',
      },
    })
    await prisma.file.create({
      data: {
        userId: owner.id,
        workspaceId: ws.id,
        name: 'b.txt',
        ext: 'txt',
        fileSize: 999n,
        mimeType: 'text/plain',
        hash: 'h2',
        path: 'p2',
        status: 'DELETED',
      },
    })

    const result = await caller.getUsage({ workspaceId: ws.id })
    expect(result.usage.fileBytesUsed).toBe('1000')
  })
})
