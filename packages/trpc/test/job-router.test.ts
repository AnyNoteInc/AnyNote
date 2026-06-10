import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@repo/db'

import { jobRouter } from '../src/routers/job'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the job router (export.create / import.create /
// list / delete). Uses an email-suffix fixture namespace so it self-cleans.
// Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+job-router-test@anynote.dev'

async function cleanFixtures() {
  const byWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.exportJob.deleteMany({ where: byWs })
  await prisma.importJob.deleteMany({ where: byWs })
  await prisma.page.deleteMany({ where: byWs })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.collection.deleteMany({ where: byWs })
  await prisma.workspaceMember.deleteMany({ where: byWs })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
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

function makeCaller(userId: string, kick = vi.fn()) {
  const caller = createCallerFactory(jobRouter)({
    prisma,
    user: { id: userId, email: 'x', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
    jobs: { kick },
  })
  return { caller, kick }
}

// requireWritableWorkspace resolves the owner's plan and falls back to the
// `personal` plan row via findUniqueOrThrow — make it self-contained so the
// suite passes on a fresh CI DB that hasn't been seeded.
async function ensurePersonalPlan() {
  await prisma.plan.upsert({
    where: { slug: 'personal' },
    update: {},
    create: { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
  })
}

async function seed() {
  await ensurePersonalPlan()
  const owner = await makeUser('owner')
  const stranger = await makeUser('stranger')
  const ws = await prisma.workspace.create({ data: { name: 'JobWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: stranger.id, role: 'EDITOR' },
    ],
  })
  const team = await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })
  const page = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'P',
      collectionId: team.id,
      createdById: owner.id,
    },
  })
  return { owner, stranger, ws, team, page }
}

describe('job router', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('export.create inserts a QUEUED job and kicks the runner', async () => {
    const { owner, ws } = await seed()
    const { caller, kick } = makeCaller(owner.id)
    const { id } = await caller.export.create({
      workspaceId: ws.id,
      scope: 'WORKSPACE',
      format: 'MARKDOWN_ZIP',
    })
    expect(kick).toHaveBeenCalledWith(id, 'export')
    const job = await prisma.exportJob.findUniqueOrThrow({ where: { id } })
    expect(job.status).toBe('QUEUED')
  })

  it('enforces one active export per workspace (CONFLICT)', async () => {
    const { owner, ws } = await seed()
    const { caller } = makeCaller(owner.id)
    await caller.export.create({ workspaceId: ws.id, scope: 'WORKSPACE', format: 'HTML_ZIP' })
    await expect(
      caller.export.create({ workspaceId: ws.id, scope: 'WORKSPACE', format: 'HTML_ZIP' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('two concurrent creates cannot both become active (partial unique index)', async () => {
    const { owner, ws } = await seed()
    const { caller } = makeCaller(owner.id)
    const results = await Promise.allSettled([
      caller.export.create({ workspaceId: ws.id, scope: 'WORKSPACE', format: 'MARKDOWN_ZIP' }),
      caller.export.create({ workspaceId: ws.id, scope: 'WORKSPACE', format: 'HTML_ZIP' }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled.length).toBe(1)
    const active = await prisma.exportJob.count({
      where: { workspaceId: ws.id, status: { in: ['QUEUED', 'PROCESSING'] } },
    })
    expect(active).toBe(1)
  })

  it('the DB rejects a second active job even if the pre-flight is bypassed', async () => {
    const { owner, ws } = await seed()
    await prisma.exportJob.create({
      data: { workspaceId: ws.id, userId: owner.id, scope: 'WORKSPACE', format: 'MARKDOWN_ZIP' },
    })
    await expect(
      prisma.exportJob.create({
        data: { workspaceId: ws.id, userId: owner.id, scope: 'WORKSPACE', format: 'HTML_ZIP' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('export.create SUBTREE rejects a page the caller cannot see', async () => {
    const { owner, stranger, ws, page } = await seed()
    const personal = await prisma.collection.create({
      data: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: owner.id },
    })
    await prisma.page.update({ where: { id: page.id }, data: { collectionId: personal.id } })
    const { caller } = makeCaller(stranger.id)
    await expect(
      caller.export.create({
        workspaceId: ws.id,
        scope: 'SUBTREE',
        scopeId: page.id,
        format: 'MARKDOWN_ZIP',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it("import.create rejects another user's file", async () => {
    const { owner, stranger, ws } = await seed()
    const file = await prisma.file.create({
      data: {
        userId: stranger.id,
        workspaceId: ws.id,
        name: 's.zip',
        ext: 'zip',
        fileSize: 1n,
        mimeType: 'application/zip',
        hash: 'h1',
        path: 't/s.zip',
        status: 'ACTIVE',
        isPublic: false,
      },
    })
    const { caller } = makeCaller(owner.id)
    await expect(
      caller.import.create({ workspaceId: ws.id, fileId: file.id, format: 'ZIP' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('import.create rejects an archived parent page', async () => {
    const { owner, ws, page } = await seed()
    await prisma.page.update({ where: { id: page.id }, data: { archivedAt: new Date() } })
    const file = await prisma.file.create({
      data: {
        userId: owner.id,
        workspaceId: ws.id,
        name: 's.zip',
        ext: 'zip',
        fileSize: 1n,
        mimeType: 'application/zip',
        hash: 'h3',
        path: 't/s3.zip',
        status: 'ACTIVE',
        isPublic: false,
      },
    })
    const { caller } = makeCaller(owner.id)
    await expect(
      caller.import.create({ workspaceId: ws.id, fileId: file.id, format: 'ZIP', parentId: page.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('list returns only the caller’s jobs', async () => {
    const { owner, stranger, ws } = await seed()
    await prisma.exportJob.create({
      data: { workspaceId: ws.id, userId: stranger.id, scope: 'WORKSPACE', format: 'HTML_ZIP' },
    })
    const { caller } = makeCaller(owner.id)
    const rows = await caller.list({ workspaceId: ws.id })
    expect(rows.length).toBe(0)
  })

  it('list reclaims a stale PROCESSING job back to QUEUED and re-kicks it', async () => {
    const { owner, ws } = await seed()
    const stale = new Date(Date.now() - 11 * 60 * 1000)
    const job = await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: owner.id,
        scope: 'WORKSPACE',
        format: 'MARKDOWN_ZIP',
        status: 'PROCESSING',
        startedAt: stale,
        heartbeatAt: stale,
      },
    })
    const { caller, kick } = makeCaller(owner.id)
    await caller.list({ workspaceId: ws.id })
    expect(kick).toHaveBeenCalledWith(job.id, 'export')
    const reclaimed = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(reclaimed.status).toBe('QUEUED')
  })

  it('list does NOT reclaim a fresh PROCESSING job', async () => {
    const { owner, ws } = await seed()
    await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: owner.id,
        scope: 'WORKSPACE',
        format: 'MARKDOWN_ZIP',
        status: 'PROCESSING',
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
    })
    const { caller, kick } = makeCaller(owner.id)
    await caller.list({ workspaceId: ws.id })
    expect(kick).not.toHaveBeenCalled()
  })

  it('export artifacts do not appear in the workspace file library', async () => {
    const { owner, ws } = await seed()
    const artifact = await prisma.file.create({
      data: {
        userId: owner.id,
        workspaceId: null,
        name: 'anynote-export',
        ext: 'zip',
        fileSize: 1n,
        mimeType: 'application/zip',
        hash: 'h-lib',
        path: 'exports/lib.zip',
        status: 'ACTIVE',
        isPublic: false,
      },
    })
    // file.listWorkspace filters `workspaceId: input.workspaceId` + ACTIVE —
    // a workspaceId-null artifact can never satisfy that predicate.
    const rows = await prisma.file.findMany({ where: { workspaceId: ws.id, status: 'ACTIVE' } })
    expect(rows.map((r) => r.id)).not.toContain(artifact.id)
  })

  it('delete removes an export job together with its artifact file row', async () => {
    const { owner, ws } = await seed()
    const file = await prisma.file.create({
      data: {
        userId: owner.id,
        workspaceId: ws.id,
        name: 'anynote-export',
        ext: 'zip',
        fileSize: 1n,
        mimeType: 'application/zip',
        hash: 'h2',
        path: 'exports/x.zip',
        status: 'ACTIVE',
        isPublic: false,
      },
    })
    const job = await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: owner.id,
        scope: 'WORKSPACE',
        format: 'MARKDOWN_ZIP',
        status: 'DONE',
        artifacts: { create: { fileId: file.id } },
      },
    })
    const { caller } = makeCaller(owner.id)
    await caller.delete({ workspaceId: ws.id, kind: 'export', jobId: job.id })
    expect(await prisma.exportJob.findUnique({ where: { id: job.id } })).toBeNull()
    expect(await prisma.file.findUnique({ where: { id: file.id } })).toBeNull()
  })
})
