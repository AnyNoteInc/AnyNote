import { Readable } from 'node:stream'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { prisma } from '@repo/db'

import { processExportJob, type ExportJobContext } from '@/server/jobs/process-export-job'
import { streamToBuffer } from '@/server/jobs/process-import-job'

const EMAIL_SUFFIX = '+export-job-test@anynote.dev'

function makeFakeStorage(initial: Record<string, Buffer> = {}) {
  const store = new Map<string, Buffer>(Object.entries(initial))
  return {
    store,
    async get(key: string): Promise<Readable> {
      const buf = store.get(key)
      if (!buf) throw new Error(`missing ${key}`)
      return Readable.from([buf])
    },
    async put(key: string, body: Readable | Buffer): Promise<void> {
      store.set(key, Buffer.isBuffer(body) ? body : await streamToBuffer(body))
    },
  }
}

const stubDatabase = {
  listProperties: async () => [{ id: 'p1', name: 'Статус' }],
  listRows: async () => ({
    rows: [{ title: 'Строка', cells: { p1: 'Готово' } }],
    nextCursor: null,
  }),
}

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.exportJob.deleteMany({ where })
  await prisma.page.deleteMany({ where })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed() {
  const user = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'o',
      firstName: 'O',
      lastName: 'T',
    },
  })
  const ws = await prisma.workspace.create({ data: { name: 'ExpJobWS', createdById: user.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' },
  })
  const team = await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })

  const img = await prisma.file.create({
    data: {
      userId: user.id,
      workspaceId: ws.id,
      name: 'pic',
      ext: 'png',
      fileSize: 4n,
      mimeType: 'image/png',
      hash: 'img-hash',
      path: 'test/pic.png',
      status: 'ACTIVE',
      isPublic: false,
    },
  })
  const child = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Ребёнок',
      collectionId: team.id,
      createdById: user.id,
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'дочерний' }] }],
      },
    },
  })
  const root = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Родитель',
      collectionId: team.id,
      createdById: user.id,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'см. ребёнка',
                marks: [{ type: 'link', attrs: { href: `/pages/${child.id}` } }],
              },
            ],
          },
          { type: 'image', attrs: { src: `/api/files/${img.id}` } },
        ],
      },
    },
  })
  await prisma.page.update({ where: { id: child.id }, data: { parentId: root.id } })
  const job = await prisma.exportJob.create({
    data: {
      workspaceId: ws.id,
      userId: user.id,
      scope: 'SUBTREE',
      scopeId: root.id,
      format: 'MARKDOWN_ZIP',
    },
  })
  const storage = makeFakeStorage({ 'test/pic.png': Buffer.from([1, 2, 3, 4]) })
  const ctx: ExportJobContext = {
    prisma,
    storage,
    database: stubDatabase,
    baseUrl: 'https://t.test',
  }
  return { user, ws, team, root, child, img, job, storage, ctx }
}

describe('processExportJob', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('builds a notion-style zip with relative links and bundled assets', async () => {
    const { job, ctx, storage, child, img } = await seed()
    await processExportJob(ctx, job.id)

    const done = await prisma.exportJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { artifacts: { include: { file: true } } },
    })
    expect(done.status).toBe('DONE')
    expect(done.artifacts.length).toBe(1)
    expect(done.artifacts[0]!.file.expiresAt).not.toBeNull()

    const zip = unzipSync(new Uint8Array(storage.store.get(`exports/${job.id}.zip`)!))
    const names = Object.keys(zip)
    expect(names).toContain('Родитель.md')
    expect(names).toContain('Родитель/Ребёнок.md')
    expect(names).toContain(`assets/${img.id}.png`)

    const rootMd = strFromU8(zip['Родитель.md']!)
    expect(rootMd).toContain('# Родитель')
    expect(rootMd).toContain('Родитель/Ребёнок.md')
    expect(rootMd).toContain(`assets/${img.id}.png`)
    expect(rootMd).not.toContain(`/pages/${child.id}`)
  })

  it('never bundles files from another workspace, even when referenced by content', async () => {
    const { ws, team, user, ctx, storage } = await seed()
    const foreignWs = await prisma.workspace.create({
      data: { name: 'ForeignWS', createdById: user.id },
    })
    const foreignFile = await prisma.file.create({
      data: {
        userId: user.id,
        workspaceId: foreignWs.id,
        name: 'secret',
        ext: 'png',
        fileSize: 4n,
        mimeType: 'image/png',
        hash: 'foreign-hash',
        path: 'test/secret.png',
        status: 'ACTIVE',
        isPublic: false,
      },
    })
    storage.store.set('test/secret.png', Buffer.from([9, 9, 9, 9]))
    const page = await prisma.page.create({
      data: {
        workspaceId: ws.id,
        type: 'TEXT',
        title: 'Хитрая',
        collectionId: team.id,
        createdById: user.id,
        content: {
          type: 'doc',
          content: [{ type: 'image', attrs: { src: `/api/files/${foreignFile.id}` } }],
        },
      },
    })
    const job = await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: user.id,
        scope: 'SUBTREE',
        scopeId: page.id,
        format: 'MARKDOWN_ZIP',
      },
    })
    await processExportJob(ctx, job.id)
    const done = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(done.status).toBe('DONE')
    const zip = unzipSync(new Uint8Array(storage.store.get(`exports/${job.id}.zip`)!))
    expect(Object.keys(zip).some((n) => n.includes(foreignFile.id))).toBe(false)
    // The reference degrades to an absolute URL, not a bundled asset.
    const md = strFromU8(zip['Хитрая.md']!)
    expect(md).toContain(`https://t.test/api/files/${foreignFile.id}`)
  })

  it('renders DATABASE pages as a table via the database port', async () => {
    const { ws, team, user, ctx } = await seed()
    const dbPage = await prisma.page.create({
      data: {
        workspaceId: ws.id,
        type: 'DATABASE',
        title: 'База',
        collectionId: team.id,
        createdById: user.id,
      },
    })
    const job = await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: user.id,
        scope: 'SUBTREE',
        scopeId: dbPage.id,
        format: 'MARKDOWN_ZIP',
      },
    })
    await processExportJob(ctx, job.id)
    const zip = unzipSync(
      new Uint8Array(
        (ctx.storage as unknown as { store: Map<string, Buffer> }).store.get(
          `exports/${job.id}.zip`,
        )!,
      ),
    )
    const md = strFromU8(zip['База.md']!)
    expect(md).toContain('| Название | Статус |')
    expect(md).toContain('| Строка | Готово |')
  })

  it('fails with a user error when the scope yields no pages', async () => {
    const { ws, user, ctx } = await seed()
    const job = await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: user.id,
        scope: 'SUBTREE',
        scopeId: '00000000-0000-0000-0000-000000000000',
        format: 'MARKDOWN_ZIP',
      },
    })
    await processExportJob(ctx, job.id)
    const failed = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(failed.status).toBe('FAILED')
    expect(failed.error).toBe('Нет доступных страниц для экспорта')
  })
})
