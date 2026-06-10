import { Readable } from 'node:stream'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, type Prisma } from '@repo/db'

import { domain } from '@/lib/domain'
import {
  processImportJob,
  streamToBuffer,
  type ImportJobContext,
} from '@/server/jobs/process-import-job'

// Real-DB integration test for the GENERIC CSV import path: one CSV file → one
// DATABASE page with inferred + user-overridden columns, skipped columns, the
// wizard-chosen title, idempotent resume, and the empty-file guard.

const EMAIL_SUFFIX = '+csv-import-test@anynote.dev'

// «Код» would infer NUMBER without the pin; «Статус» repeats Open across
// distinct rows so it infers SELECT; «Мусор» is dropped via the skip override.
const CSV_FIXTURE = ['Name,Код,Статус,Мусор', 'А,1,Open,x', 'Б,2,Done,y', 'В,3,Open,z', ''].join(
  '\n',
)

const OPTIONS = {
  location: 'team',
  parentId: null,
  columnOverrides: { '1': 'TEXT', '3': 'skip' },
  databaseTitle: 'Реестр',
}

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

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  const wsWhere = { createdBy: { email: { contains: EMAIL_SUFFIX } } }
  const wsIds = (await prisma.workspace.findMany({ where: wsWhere, select: { id: true } })).map(
    (w) => w.id,
  )
  await prisma.importJob.deleteMany({ where })
  await prisma.databaseCellValue.deleteMany({ where: { row: { source: { workspace: wsWhere } } } })
  await prisma.databaseRow.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseProperty.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseView.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseSource.deleteMany({ where: { workspace: wsWhere } })
  await prisma.pageFile.deleteMany({ where: { page: where } })
  if (wsIds.length > 0) {
    await prisma.outboxEvent.deleteMany({ where: { workspaceId: { in: wsIds } } })
  }
  await prisma.page.deleteMany({ where })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspaceLimit.deleteMany({ where })
  await prisma.workspace.deleteMany({ where: wsWhere })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed(csvText: string, options: Prisma.InputJsonValue = OPTIONS) {
  const user = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'owner',
      firstName: 'O',
      lastName: 'T',
    },
  })
  const ws = await prisma.workspace.create({ data: { name: 'CsvImportWS', createdById: user.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' },
  })
  await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })
  await prisma.workspaceLimit.create({
    data: { workspaceId: ws.id, maxMembers: 100, maxFileBytes: 10n ** 12n, syncedAt: new Date() },
  })
  const bytes = Buffer.from(csvText, 'utf-8')
  const sourceFile = await prisma.file.create({
    data: {
      userId: user.id,
      workspaceId: ws.id,
      name: 'table.csv',
      ext: 'csv',
      fileSize: BigInt(bytes.byteLength),
      mimeType: 'text/plain',
      hash: 'test-csv-hash',
      path: 'test/table.csv',
      status: 'ACTIVE',
      isPublic: false,
    },
  })
  const job = await prisma.importJob.create({
    data: {
      workspaceId: ws.id,
      userId: user.id,
      format: 'CSV',
      source: 'GENERIC',
      options,
      artifacts: { create: { fileId: sourceFile.id, kind: 'SOURCE' } },
    },
  })
  const storage = makeFakeStorage({ 'test/table.csv': bytes })
  const ctx: ImportJobContext = { prisma, storage, pages: domain.pages, database: domain.database }
  return { user, ws, job, storage, ctx }
}

describe('processImportJob — GENERIC CSV', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('materializes a typed database honoring overrides, skip, title and journals the pins', async () => {
    const { user, ws, job, storage, ctx } = await seed(CSV_FIXTURE)
    await processImportJob(ctx, job.id)

    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(done.status).toBe('DONE')
    expect(done.total).toBe(4) // db page + 3 rows
    expect(done.processed).toBe(4)

    const dbPage = await prisma.page.findFirstOrThrow({
      where: { workspaceId: ws.id, type: 'DATABASE' },
    })
    expect(dbPage.title).toBe('Реестр')
    expect(dbPage.parentId).toBeNull()

    const props = await domain.database.listProperties(user.id, dbPage.id)
    const kod = props.find((p) => p.name === 'Код')
    // The pin: «Код» would infer NUMBER ('1','2','3'), the override forces TEXT.
    expect(kod?.type).toBe('TEXT')
    const status = props.find((p) => p.name === 'Статус')
    expect(status?.type).toBe('SELECT')
    const options = (status?.settings as { options: Array<{ id: string; label: string }> }).options
    expect(options.map((o) => o.label).sort()).toEqual(['Done', 'Open'])
    // The skipped column creates no property at all.
    expect(props.some((p) => p.name === 'Мусор')).toBe(false)

    const { rows } = await domain.database.listRows(user.id, { pageId: dbPage.id, limit: 200 })
    expect(rows.map((r) => r.title).sort()).toEqual(['А', 'Б', 'В'])
    const rowA = rows.find((r) => r.title === 'А')!
    // Pinned TEXT keeps the digits as STRINGS, not numbers.
    expect(rowA.cells[kod!.id]).toBe('1')
    const openId = options.find((o) => o.label === 'Open')!.id
    expect(rowA.cells[status!.id]).toBe(openId)
    const rowB = rows.find((r) => r.title === 'Б')!
    expect(rowB.cells[kod!.id]).toBe('2')
    expect(rowB.cells[status!.id]).toBe(options.find((o) => o.label === 'Done')!.id)

    // The REPORT artifact exists and the journal names the manual override.
    const report = await prisma.importArtifact.findFirst({
      where: { jobId: job.id, kind: 'REPORT' },
    })
    expect(report).not.toBeNull()
    const reportText = storage.store.get(`imports/${job.id}-report.txt`)?.toString('utf-8') ?? ''
    expect(reportText).toContain('тип задан вручную')
    expect(reportText).toContain('База данных «Реестр»')
  })

  it('is idempotent on re-run: still 3 rows and 2 properties', async () => {
    const { user, ws, job, ctx } = await seed(CSV_FIXTURE)
    await processImportJob(ctx, job.id)

    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED', heartbeatAt: null },
    })
    await processImportJob(ctx, job.id)

    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(done.status).toBe('DONE')
    const dbPage = await prisma.page.findFirstOrThrow({
      where: { workspaceId: ws.id, type: 'DATABASE' },
    })
    const props = await domain.database.listProperties(user.id, dbPage.id)
    expect(props.length).toBe(2) // Код + Статус, no duplicates, no Мусор
    const { rows } = await domain.database.listRows(user.id, { pageId: dbPage.id, limit: 200 })
    expect(rows.length).toBe(3)
  })

  it('fails a header-only CSV with the empty-file message', async () => {
    const { job, ctx } = await seed('Name,Код,Статус\n', { location: 'team', parentId: null })
    await processImportJob(ctx, job.id)
    const failed = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(failed.status).toBe('FAILED')
    expect(failed.error).toBe('CSV-файл пуст')
  })
})
