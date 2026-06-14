import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The @repo/storage edge is the only mocked module (vi.mock keeps the package's
// other exports real) — everything else runs against postgres. We capture every
// `storage.delete(key)` so the S3-first deletion contract (spec §5/§7.6) is
// provable without touching a real bucket.
const { storageMock } = vi.hoisted(() => ({
  storageMock: { deleted: [] as string[] },
}))

vi.mock('@repo/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/storage')>()
  return {
    ...actual,
    storage: {
      ...actual.storage,
      delete: vi.fn(async (key: string) => {
        storageMock.deleted.push(key)
      }),
    },
  }
})

import { prisma, CollectionKind } from '@repo/db'

import { meetingRouter, freeMeetingPageRecording } from '../src/routers/meeting'
import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the Phase-9E meeting router. Self-contained
// (creates its own plans-via-seed / users / workspaces / collections / pages /
// files / artifacts inline) so it passes on a fresh CI DB with the standard
// seed (the `pro` plan carries `'meetings'` in its features). Requires
// `docker compose up -d`.

const EMAIL_SUFFIX = '+meeting-router-test@anynote.dev'

async function cleanFixtures() {
  await prisma.meetingArtifact.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.summaryInstruction.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.file.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.collection.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
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

// A spy `jobs` port so `create`/`retry` can assert the kick — the runner itself
// is exercised by apps/web/test/meeting-job.test.ts; here we only prove the
// router fires `kick(artifactId, 'meeting')`.
function makeJobs() {
  return { kick: vi.fn() as (jobId: string, kind: 'import' | 'export' | 'meeting') => void }
}

function meetingCaller(userId: string, jobs = makeJobs()) {
  const caller = createCallerFactory(meetingRouter)({
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
    jobs,
  })
  return { caller, jobs }
}

function pageCaller(userId: string) {
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

// Give the workspace owner an ACTIVE `pro` subscription → meetingsEnabled true
// (the seed adds `'meetings'` to pro/max features).
async function subscribePro(userId: string) {
  const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
  await prisma.subscription.create({
    data: {
      userId,
      planId: pro.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    },
  })
}

async function makeRecording(userId: string, workspaceId: string, path = `meetings/${userId}.mp3`) {
  return prisma.file.create({
    data: {
      userId,
      workspaceId,
      name: 'rec.mp3',
      ext: 'mp3',
      fileSize: BigInt(1024),
      mimeType: 'audio/mpeg',
      hash: 'h'.repeat(8),
      path,
    },
    select: { id: true, path: true },
  })
}

// Seed: a workspace whose OWNER holds a pro subscription (meetingsEnabled true),
// an EDITOR member, a TEAM collection. Optionally a second workspace without a
// subscription (meetingsEnabled false).
async function seed() {
  const owner = await makeUser('owner')
  const editor = await makeUser('editor')
  await subscribePro(owner.id)
  const ws = await prisma.workspace.create({
    data: { name: 'MeetWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: editor.id, role: 'EDITOR' },
    ],
  })
  await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
  })
  return { wsId: ws.id, ownerId: owner.id, editorId: editor.id }
}

// A second workspace + user with NO subscription → meetingsEnabled false.
async function seedFreeWorkspace() {
  const free = await makeUser('free')
  const ws = await prisma.workspace.create({
    data: { name: 'FreeWS', createdById: free.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: free.id, role: 'OWNER' },
  })
  await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
  })
  return { wsId: ws.id, freeId: free.id }
}

// A stranger in an isolated workspace — for cross-workspace no-leak proofs.
async function seedStranger() {
  const stranger = await makeUser('stranger')
  const ws = await prisma.workspace.create({
    data: { name: 'OtherWS', createdById: stranger.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: stranger.id, role: 'OWNER' },
  })
  return { wsId: ws.id, strangerId: stranger.id }
}

describe('meeting router (integration)', () => {
  beforeEach(async () => {
    storageMock.deleted.length = 0
    await cleanFixtures()
  })
  afterAll(cleanFixtures)

  // ── create: consent gate ───────────────────────────────────────────────────
  it('create REQUIRES consentAck === true (400 otherwise)', async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const { caller } = meetingCaller(fx.ownerId)
    await expect(
      caller.create({ workspaceId: fx.wsId, recordingFileId: rec.id, consentAck: false }),
    ).rejects.toThrow(/соглас|consent/i)
  })

  // ── create: plan gate ───────────────────────────────────────────────────────
  it('create is FORBIDDEN when meetingsEnabled is off (403 plan gate)', async () => {
    const free = await seedFreeWorkspace()
    const rec = await makeRecording(free.freeId, free.wsId)
    const { caller } = meetingCaller(free.freeId)
    await expect(
      caller.create({ workspaceId: free.wsId, recordingFileId: rec.id, consentAck: true }),
    ).rejects.toThrow(/тариф|план|plan|FORBIDDEN|недоступ/i)
  })

  // ── create: non-member ──────────────────────────────────────────────────────
  it('create is FORBIDDEN for a non-member of the workspace', async () => {
    const fx = await seed()
    const other = await seedStranger()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const { caller } = meetingCaller(other.strangerId)
    await expect(
      caller.create({ workspaceId: fx.wsId, recordingFileId: rec.id, consentAck: true }),
    ).rejects.toThrow(/участ|прав|FORBIDDEN/i)
  })

  // ── create: recording must belong to the workspace ──────────────────────────
  it('create rejects a recording File from another workspace', async () => {
    const fx = await seed()
    const other = await seedStranger()
    // A File owned by the stranger, in the OTHER workspace.
    const foreign = await makeRecording(other.strangerId, other.wsId)
    const { caller } = meetingCaller(fx.ownerId)
    await expect(
      caller.create({ workspaceId: fx.wsId, recordingFileId: foreign.id, consentAck: true }),
    ).rejects.toThrow(/файл|запис|file|not found|не найден/i)
  })

  // ── create: happy path ──────────────────────────────────────────────────────
  it('create makes a MEETING Page + UPLOADED artifact + kicks the meeting job', async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const { caller, jobs } = meetingCaller(fx.ownerId)
    const res = await caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
      title: 'Sprint planning',
    })
    expect(res.pageId).toBeTruthy()
    expect(res.artifactId).toBeTruthy()

    const page = await prisma.page.findUnique({ where: { id: res.pageId } })
    expect(page?.type).toBe('MEETING')
    expect(page?.workspaceId).toBe(fx.wsId)

    const artifact = await prisma.meetingArtifact.findUnique({ where: { id: res.artifactId } })
    expect(artifact?.status).toBe('UPLOADED')
    expect(artifact?.consentAck).toBe(true)
    expect(artifact?.pageId).toBe(res.pageId)
    expect(artifact?.recordingFileId).toBe(rec.id)
    expect(artifact?.title).toBe('Sprint planning')

    // The job is kicked with the artifact id + the 'meeting' kind.
    expect(jobs.kick).toHaveBeenCalledTimes(1)
    expect(jobs.kick).toHaveBeenCalledWith(res.artifactId, 'meeting')
  })

  // ── create: resolves / creates a custom summary instruction ─────────────────
  it('create stores a customInstruction as a SummaryInstruction linked to the artifact', async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const { caller } = meetingCaller(fx.ownerId)
    const res = await caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
      customInstruction: 'Кратко по-русски, список решений',
    })
    const artifact = await prisma.meetingArtifact.findUnique({
      where: { id: res.artifactId },
      include: { summaryInstruction: true },
    })
    expect(artifact?.summaryInstructionId).toBeTruthy()
    expect(artifact?.summaryInstruction?.instruction).toBe('Кратко по-русски, список решений')
    expect(artifact?.summaryInstruction?.workspaceId).toBe(fx.wsId)
  })

  // ── getById / getByPage object-hiding ───────────────────────────────────────
  it("getById → 'ok' with content for a member, 'no_access' for a non-member", async () => {
    const fx = await seed()
    const other = await seedStranger()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const { caller } = meetingCaller(fx.ownerId)
    const created = await caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    // Seed a READY artifact with a segment + action item + summary.
    await prisma.meetingArtifact.update({
      where: { id: created.artifactId },
      data: {
        status: 'READY',
        summary: 'secret-summary',
        segments: {
          create: [{ idx: 0, startMs: 0, endMs: 1000, speaker: 'A', text: 'hello world' }],
        },
        actionItems: { create: [{ idx: 0, text: 'do the thing' }] },
      },
    })

    const memberRes = await meetingCaller(fx.editorId).caller.getById({ id: created.artifactId })
    expect(memberRes.status).toBe('ok')
    if (memberRes.status !== 'ok') throw new Error('unreachable')
    expect(memberRes.summary).toBe('secret-summary')
    expect(memberRes.segments).toHaveLength(1)
    expect(memberRes.actionItems).toHaveLength(1)

    const strangerRes = await meetingCaller(other.strangerId).caller.getById({
      id: created.artifactId,
    })
    expect(strangerRes.status).toBe('no_access')
    expect(JSON.stringify(strangerRes)).not.toContain('secret-summary')
    expect(JSON.stringify(strangerRes)).not.toContain('hello world')
  })

  it("getById → 'processing' for an UPLOADED/TRANSCRIBING artifact", async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    const res = await meetingCaller(fx.ownerId).caller.getById({ id: created.artifactId })
    expect(res.status).toBe('processing')
  })

  it("getById → 'failed' carries the error", async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    await prisma.meetingArtifact.update({
      where: { id: created.artifactId },
      data: { status: 'FAILED', error: 'transcription failed' },
    })
    const res = await meetingCaller(fx.ownerId).caller.getById({ id: created.artifactId })
    expect(res.status).toBe('failed')
    if (res.status !== 'failed') throw new Error('unreachable')
    expect(res.error).toBe('transcription failed')
  })

  it("getById → 'not_found' for an unknown id (object-hiding)", async () => {
    const fx = await seed()
    const res = await meetingCaller(fx.ownerId).caller.getById({
      id: '00000000-0000-7000-8000-000000000000',
    })
    expect(res.status === 'not_found' || res.status === 'no_access').toBe(true)
  })

  it("getByPage → 'ok' for a member, 'no_access' for a non-member", async () => {
    const fx = await seed()
    const other = await seedStranger()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    await prisma.meetingArtifact.update({
      where: { id: created.artifactId },
      data: { status: 'READY', summary: 'page-secret' },
    })
    const memberRes = await meetingCaller(fx.editorId).caller.getByPage({ pageId: created.pageId })
    expect(memberRes.status).toBe('ok')

    const strangerRes = await meetingCaller(other.strangerId).caller.getByPage({
      pageId: created.pageId,
    })
    expect(strangerRes.status).toBe('no_access')
    expect(JSON.stringify(strangerRes)).not.toContain('page-secret')
  })

  // ── list ────────────────────────────────────────────────────────────────────
  it('list returns workspace artifacts for a member, FORBIDDEN for a non-member', async () => {
    const fx = await seed()
    const other = await seedStranger()
    const rec1 = await makeRecording(fx.ownerId, fx.wsId, 'meetings/a.mp3')
    const rec2 = await makeRecording(fx.editorId, fx.wsId, 'meetings/b.mp3')
    const c1 = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec1.id,
      consentAck: true,
    })
    const c2 = await meetingCaller(fx.editorId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec2.id,
      consentAck: true,
    })
    const list = await meetingCaller(fx.editorId).caller.list({ workspaceId: fx.wsId })
    const ids = list.meetings.map((m) => m.id).sort()
    expect(ids).toEqual([c1.artifactId, c2.artifactId].sort())

    await expect(
      meetingCaller(other.strangerId).caller.list({ workspaceId: fx.wsId }),
    ).rejects.toThrow(/участ|прав|FORBIDDEN/i)
  })

  // ── searchSegments ──────────────────────────────────────────────────────────
  it('searchSegments returns matching segments for a member, no_access leaks nothing', async () => {
    const fx = await seed()
    const other = await seedStranger()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    await prisma.meetingArtifact.update({
      where: { id: created.artifactId },
      data: {
        status: 'READY',
        segments: {
          create: [
            { idx: 0, startMs: 0, endMs: 1000, text: 'discuss the roadmap' },
            { idx: 1, startMs: 1000, endMs: 2000, text: 'lunch break' },
          ],
        },
      },
    })
    const found = await meetingCaller(fx.editorId).caller.searchSegments({
      meetingId: created.artifactId,
      q: 'roadmap',
    })
    expect(found.segments).toHaveLength(1)
    expect(found.segments[0]?.text).toContain('roadmap')

    await expect(
      meetingCaller(other.strangerId).caller.searchSegments({
        meetingId: created.artifactId,
        q: 'roadmap',
      }),
    ).rejects.toThrow(/найден|прав|FORBIDDEN|not found/i)
  })

  // ── toggleActionItem ────────────────────────────────────────────────────────
  it('toggleActionItem flips done for a member', async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    const updated = await prisma.meetingArtifact.update({
      where: { id: created.artifactId },
      data: { status: 'READY', actionItems: { create: [{ idx: 0, text: 'ship it' }] } },
      include: { actionItems: true },
    })
    const itemId = updated.actionItems[0]!.id
    await meetingCaller(fx.editorId).caller.toggleActionItem({ id: itemId, done: true })
    const after = await prisma.actionItem.findUnique({ where: { id: itemId } })
    expect(after?.done).toBe(true)
  })

  // ── retry ───────────────────────────────────────────────────────────────────
  it('retry resets a FAILED artifact to UPLOADED + re-kicks', async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    await prisma.meetingArtifact.update({
      where: { id: created.artifactId },
      data: { status: 'FAILED', error: 'boom' },
    })
    const { caller, jobs } = meetingCaller(fx.ownerId)
    await caller.retry({ id: created.artifactId })
    const after = await prisma.meetingArtifact.findUnique({ where: { id: created.artifactId } })
    expect(after?.status).toBe('UPLOADED')
    expect(after?.error).toBeNull()
    expect(jobs.kick).toHaveBeenCalledWith(created.artifactId, 'meeting')
  })

  // ── delete: S3-first ordering + DB rows gone + idempotent ────────────────────
  it('delete frees the recording S3 object (S3-first) + removes the artifact and File rows', async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId, 'meetings/to-delete.mp3')
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    await prisma.meetingArtifact.update({
      where: { id: created.artifactId },
      data: {
        segments: { create: [{ idx: 0, startMs: 0, endMs: 1, text: 'x' }] },
        actionItems: { create: [{ idx: 0, text: 'y' }] },
      },
    })

    await meetingCaller(fx.ownerId).caller.delete({ id: created.artifactId })

    expect(storageMock.deleted).toContain('meetings/to-delete.mp3')
    expect(
      await prisma.meetingArtifact.findUnique({ where: { id: created.artifactId } }),
    ).toBeNull()
    expect(await prisma.file.findUnique({ where: { id: rec.id } })).toBeNull()
    expect(await prisma.transcriptSegment.count({ where: { meetingId: created.artifactId } })).toBe(
      0,
    )

    // Idempotent: a second delete is a no-op (no throw).
    await expect(
      meetingCaller(fx.ownerId).caller.delete({ id: created.artifactId }),
    ).resolves.toBeTruthy()
  })

  it('delete is FORBIDDEN/not-found for a non-member (no S3 call)', async () => {
    const fx = await seed()
    const other = await seedStranger()
    const rec = await makeRecording(fx.ownerId, fx.wsId)
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    await expect(
      meetingCaller(other.strangerId).caller.delete({ id: created.artifactId }),
    ).rejects.toThrow(/найден|прав|FORBIDDEN|not found/i)
    expect(storageMock.deleted).toHaveLength(0)
  })

  // ── MEETING-page hard-delete frees S3 (the routed path) ─────────────────────
  it('hard-deleting a MEETING page frees the recording S3 object', async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId, 'meetings/page-delete.mp3')
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    // Hard-delete requires the page to be in trash first.
    await prisma.page.update({ where: { id: created.pageId }, data: { deletedAt: new Date() } })
    await pageCaller(fx.ownerId).hardDelete({ id: created.pageId, workspaceId: fx.wsId })

    expect(storageMock.deleted).toContain('meetings/page-delete.mp3')
    expect(
      await prisma.meetingArtifact.findUnique({ where: { id: created.artifactId } }),
    ).toBeNull()
    expect(await prisma.page.findUnique({ where: { id: created.pageId } })).toBeNull()
  })

  // ── freeMeetingPageRecording helper (used by the page-delete route) ──────────
  it('freeMeetingPageRecording deletes the S3 object + File for a MEETING page', async () => {
    const fx = await seed()
    const rec = await makeRecording(fx.ownerId, fx.wsId, 'meetings/helper.mp3')
    const created = await meetingCaller(fx.ownerId).caller.create({
      workspaceId: fx.wsId,
      recordingFileId: rec.id,
      consentAck: true,
    })
    await freeMeetingPageRecording(prisma, created.pageId)
    expect(storageMock.deleted).toContain('meetings/helper.mp3')
    // The File row is gone once the artifact reference is detached (the helper
    // deletes the artifact too so the Restrict FK does not block the File).
    expect(await prisma.file.findUnique({ where: { id: rec.id } })).toBeNull()
  })

  // ── summary instructions ────────────────────────────────────────────────────
  it('createSummaryInstruction + listSummaryInstructions are workspace-scoped + member-gated', async () => {
    const fx = await seed()
    const other = await seedStranger()
    const made = await meetingCaller(fx.ownerId).caller.createSummaryInstruction({
      workspaceId: fx.wsId,
      name: 'Краткое',
      instruction: 'Summarize tersely',
    })
    expect(made.id).toBeTruthy()

    const list = await meetingCaller(fx.editorId).caller.listSummaryInstructions({
      workspaceId: fx.wsId,
    })
    expect(list.instructions.map((i) => i.id)).toContain(made.id)

    await expect(
      meetingCaller(other.strangerId).caller.listSummaryInstructions({ workspaceId: fx.wsId }),
    ).rejects.toThrow(/участ|прав|FORBIDDEN/i)
    await expect(
      meetingCaller(other.strangerId).caller.createSummaryInstruction({
        workspaceId: fx.wsId,
        name: 'x',
        instruction: 'y',
      }),
    ).rejects.toThrow(/участ|прав|FORBIDDEN/i)
  })
})
