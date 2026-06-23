import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { workspaceRouter } from '../src/routers/workspace'
import { createCallerFactory } from '../src/trpc'

const EMAIL_SUFFIX = '+wscancreate-test@anynote.dev'

async function cleanFixtures() {
  await prisma.workspaceLimit.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({
    where: { email: { contains: EMAIL_SUFFIX } },
  })
}

async function makeOwner(label: string) {
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

function callerFor(owner: { id: string; email: string }) {
  return createCallerFactory(workspaceRouter)({
    prisma,
    user: { id: owner.id, email: owner.email },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost:3000',
  })
}

describe('workspace.canCreate', () => {
  beforeEach(cleanFixtures)

  it('allows creation when the user owns fewer workspaces than the plan limit', async () => {
    const owner = await makeOwner('under')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const caller = callerFor(owner)
    await caller.create({ name: 'WS1' })
    await caller.create({ name: 'WS2' })

    const result = await caller.canCreate()
    expect(result.allowed).toBe(true)
    expect(result.owned).toBe(2)
    expect(result.maxWorkspaces).toBe(3)
  })

  it('blocks creation when the user already owns the plan limit (Pro + 3 workspaces)', async () => {
    const owner = await makeOwner('atlimit')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const caller = callerFor(owner)
    await caller.create({ name: 'WS1' })
    await caller.create({ name: 'WS2' })
    await caller.create({ name: 'WS3' })

    const result = await caller.canCreate()
    expect(result.allowed).toBe(false)
    expect(result.owned).toBe(3)
    expect(result.maxWorkspaces).toBe(3)
  })

  it('agrees with workspace.create: when canCreate is false, create throws the plan-limit error', async () => {
    const owner = await makeOwner('agree')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const caller = callerFor(owner)
    await caller.create({ name: 'WS1' })
    await caller.create({ name: 'WS2' })
    await caller.create({ name: 'WS3' })

    const gate = await caller.canCreate()
    expect(gate.allowed).toBe(false)
    await expect(caller.create({ name: 'WS4' })).rejects.toThrow(/не больше 3 пространств/)
  })

  it('allows creation with zero owned workspaces and reports the plan name', async () => {
    const owner = await makeOwner('zero')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const result = await callerFor(owner).canCreate()
    expect(result.allowed).toBe(true)
    expect(result.owned).toBe(0)
    expect(result.maxWorkspaces).toBe(3)
    expect(result.planName).toBeTruthy()
  })
})
