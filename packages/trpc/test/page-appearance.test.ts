import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for page.update icon/cover appearance fields
// (router → domain validation → Prisma cover_url/cover_preset columns).
// Self-contained email-suffix fixture namespace; requires `docker compose up -d`.

const EMAIL_SUFFIX = '+page-appearance-test@anynote.dev'

const FILE_URL = '/api/files/8a33ee5e-95f1-4b53-8d12-0d5dbb1c1a2f'

async function cleanFixtures() {
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.collection.deleteMany({
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

function makeCaller(userId: string) {
  return createCallerFactory(pageRouter)({
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
  })
}

async function seed() {
  const owner = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'owner',
      firstName: 'owner',
      lastName: 'Test',
    },
  })
  const ws = await prisma.workspace.create({
    data: { name: 'AppearanceWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const page = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'TEXT',
      title: 'Appearance page',
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  return { wsId: ws.id, ownerId: owner.id, pageId: page.id }
}

describe('page.update — icon/cover appearance (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('sets a gradient preset, then an uploaded cover clears the preset', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, coverPreset: 'sunset' })
    let row = await prisma.page.findUnique({
      where: { id: ctx.pageId },
      select: { coverUrl: true, coverPreset: true },
    })
    expect(row).toEqual({ coverUrl: null, coverPreset: 'sunset' })

    await caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, coverUrl: FILE_URL })
    row = await prisma.page.findUnique({
      where: { id: ctx.pageId },
      select: { coverUrl: true, coverPreset: true },
    })
    expect(row).toEqual({ coverUrl: FILE_URL, coverPreset: null })
  })

  it('explicit null clears the cover', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, coverUrl: FILE_URL })
    await caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, coverUrl: null })
    const row = await prisma.page.findUnique({
      where: { id: ctx.pageId },
      select: { coverUrl: true, coverPreset: true },
    })
    expect(row).toEqual({ coverUrl: null, coverPreset: null })
  })

  it('stores an image icon in the url: format', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, icon: `url:${FILE_URL}` })
    const row = await prisma.page.findUnique({
      where: { id: ctx.pageId },
      select: { icon: true },
    })
    expect(row?.icon).toBe(`url:${FILE_URL}`)
  })

  it('a no-op clear of already-null cover fields emits no properties_updated rows', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, coverUrl: null })
    const rows = await prisma.outboxEvent.findMany({
      where: { aggregateId: ctx.pageId, eventType: 'page.properties_updated' },
      select: { id: true },
    })
    expect(rows).toHaveLength(0)
  })

  it('a real cover change emits properties_updated with the exact changed hint', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, coverPreset: 'sunset' })
    const rows = await prisma.outboxEvent.findMany({
      where: { aggregateId: ctx.pageId, eventType: 'page.properties_updated' },
      select: { payload: true },
    })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.payload).toMatchObject({ hints: { changed: ['coverPreset'] } })
    }
  })

  it('rejects an unknown preset and a bad cover URL with BAD_REQUEST', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await expect(
      caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, coverPreset: 'neon' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.update({ id: ctx.pageId, workspaceId: ctx.wsId, coverUrl: 'http://evil.example' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
