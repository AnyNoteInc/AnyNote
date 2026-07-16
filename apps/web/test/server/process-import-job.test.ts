import { Readable } from 'node:stream'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { prisma } from '@repo/db'

import { domain } from '@/lib/domain'
import {
  processImportJob,
  streamToBuffer,
  type ImportJobContext,
} from '@/server/jobs/process-import-job'

const EMAIL_SUFFIX = '+import-job-test@anynote.dev'

function makeFakeStorage(initial: Record<string, Buffer> = {}) {
  const store = new Map<string, Buffer>(Object.entries(initial))
  let putCalls = 0
  const fake = {
    store,
    failOnPutCall: null as number | null,
    async get(key: string): Promise<Readable> {
      const buf = store.get(key)
      if (!buf) throw new Error(`missing ${key}`)
      return Readable.from([buf])
    },
    async put(key: string, body: Readable | Buffer): Promise<void> {
      putCalls += 1
      if (fake.failOnPutCall === putCalls) throw new Error('injected storage failure')
      store.set(key, Buffer.isBuffer(body) ? body : await streamToBuffer(body))
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
  }
  return fake
}

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  const wsIds = (
    await prisma.workspace.findMany({
      where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
      select: { id: true },
    })
  ).map((w) => w.id)
  await prisma.importJob.deleteMany({ where })
  await prisma.pageFile.deleteMany({ where: { page: where } })
  if (wsIds.length > 0) {
    await prisma.outboxEvent.deleteMany({ where: { workspaceId: { in: wsIds } } })
  }
  await prisma.page.deleteMany({ where })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspaceLimit.deleteMany({ where })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

const ZIP_FIXTURE = () =>
  zipSync({
    'Проект.md': strToU8(
      '# Проект\n\nСм. [план](Проект/План.md).\n\n![схема](Проект/img/схема.png)\n',
    ),
    'Проект/План.md': strToU8('# План\n\n- [ ] пункт\n'),
    'Проект/img/схема.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  })

async function seed(zipBytes: Uint8Array) {
  const user = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'owner',
      firstName: 'O',
      lastName: 'T',
    },
  })
  const ws = await prisma.workspace.create({ data: { name: 'ImportWS', createdById: user.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' },
  })
  await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })
  await prisma.workspaceLimit.create({
    data: { workspaceId: ws.id, maxMembers: 100, maxFileBytes: 10n ** 12n, syncedAt: new Date() },
  })
  const sourceFile = await prisma.file.create({
    data: {
      userId: user.id,
      workspaceId: ws.id,
      name: 'sample.zip',
      ext: 'zip',
      fileSize: BigInt(zipBytes.byteLength),
      mimeType: 'application/zip',
      hash: 'test-source-hash',
      path: 'test/source.zip',
      status: 'ACTIVE',
      isPublic: false,
    },
  })
  const job = await prisma.importJob.create({
    data: {
      workspaceId: ws.id,
      userId: user.id,
      format: 'ZIP',
      options: { location: 'team', parentId: null },
      artifacts: { create: { fileId: sourceFile.id, kind: 'SOURCE' } },
    },
  })
  const storage = makeFakeStorage({ 'test/source.zip': Buffer.from(zipBytes) })
  const ctx: ImportJobContext = { prisma, storage, pages: domain.pages, database: domain.database }
  return { user, ws, job, storage, ctx }
}

describe('processImportJob', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('imports a zip into a nested page tree with mappings, assets and rewritten links', async () => {
    const { ws, job, ctx } = await seed(ZIP_FIXTURE())
    await processImportJob(ctx, job.id)

    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(done.status).toBe('DONE')
    expect(done.total).toBe(2)
    expect(done.processed).toBe(2)

    const root = await prisma.page.findFirstOrThrow({
      where: { workspaceId: ws.id, title: 'Проект' },
    })
    const child = await prisma.page.findFirstOrThrow({
      where: { workspaceId: ws.id, title: 'План' },
    })
    expect(root.parentId).toBeNull()
    expect(child.parentId).toBe(root.id)
    expect(root.contentYjs?.byteLength ?? 0).toBeGreaterThan(0)

    const asset = await prisma.file.findFirstOrThrow({
      where: { workspaceId: ws.id, ext: 'png' },
    })
    const link = await prisma.pageFile.findFirst({
      where: { pageId: root.id, fileId: asset.id },
    })
    expect(link).not.toBeNull()
    const rootContent = JSON.stringify(root.content)
    expect(rootContent).toContain(`/api/files/${asset.id}`)
    expect(rootContent).toContain(`/pages/${child.id}`)

    const mappings = await prisma.importMapping.findMany({ where: { jobId: job.id } })
    expect(mappings.length).toBe(2)
    expect((done.result as { rootPageIds: string[] }).rootPageIds).toEqual([root.id])
  })

  it('is idempotent on re-run (orphan reclaim path creates no duplicates)', async () => {
    const { ws, job, ctx } = await seed(ZIP_FIXTURE())
    await processImportJob(ctx, job.id)
    const countAfterFirst = await prisma.page.count({ where: { workspaceId: ws.id } })

    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED', heartbeatAt: null },
    })
    await processImportJob(ctx, job.id)

    const countAfterSecond = await prisma.page.count({ where: { workspaceId: ws.id } })
    expect(countAfterSecond).toBe(countAfterFirst)
    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(done.status).toBe('DONE')
  })

  it('counts live pending form files against the workspace asset quota', async () => {
    const { user, ws, job, storage, ctx } = await seed(ZIP_FIXTURE())
    const active = await prisma.file.aggregate({
      where: { workspaceId: ws.id, status: 'ACTIVE' },
      _sum: { fileSize: true },
    })
    await prisma.workspaceLimit.update({
      where: { workspaceId: ws.id },
      data: { maxFileBytes: (active._sum.fileSize ?? 0n) + 4n },
    })
    await prisma.file.create({
      data: {
        userId: user.id,
        workspaceId: ws.id,
        name: 'pending-form-upload.bin',
        ext: 'bin',
        fileSize: 1n,
        mimeType: 'application/octet-stream',
        hash: 'f'.repeat(64),
        path: 'forms/test/pending.bin',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
        isPublic: false,
      },
    })

    await processImportJob(ctx, job.id)

    expect(
      await prisma.file.count({ where: { workspaceId: ws.id, ext: 'png', status: 'ACTIVE' } }),
    ).toBe(0)
    expect(storage.store.get(`imports/${job.id}-report.txt`)?.toString('utf8')).toContain(
      'превышен лимит хранилища пространства',
    )
  })

  it('removes namespaced asset objects when a later import upload fails', async () => {
    const fixture = zipSync({
      'Проект.md': strToU8(
        '# Проект\n\n![первая](Проект/img/one.png)\n\n![вторая](Проект/img/two.png)\n',
      ),
      'Проект/img/one.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]),
      'Проект/img/two.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]),
    })
    const { ws, job, storage, ctx } = await seed(fixture)
    storage.failOnPutCall = 2

    await processImportJob(ctx, job.id)

    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'FAILED',
    )
    expect(
      [...storage.store.keys()].filter((key) => key.startsWith(`workspaces/${ws.id}/`)),
    ).toEqual([])
    expect(await prisma.file.count({ where: { workspaceId: ws.id, ext: 'png' } })).toBe(0)
  })

  it('fails with a user-facing error on zip-slip archives', async () => {
    const evil = zipSync({ '../evil.md': strToU8('x') })
    const { job, ctx } = await seed(evil)
    await processImportJob(ctx, job.id)
    const failed = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(failed.status).toBe('FAILED')
    expect(failed.error).toBe('Небезопасный путь в архиве')
  })
})
