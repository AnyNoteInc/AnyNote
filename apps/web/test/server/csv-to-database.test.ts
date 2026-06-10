import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { domain } from '@/lib/domain'
import {
  materializeCsvDatabase,
  type CsvDatabaseBlueprint,
  type MaterializeContext,
} from '@/server/page-import/csv-to-database'
import { ImportJournal } from '@/server/page-import/journal'

const EMAIL_SUFFIX = '+csv-db-test@anynote.dev'

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  const wsWhere = { createdBy: { email: { contains: EMAIL_SUFFIX } } }
  const wsIds = (await prisma.workspace.findMany({ where: wsWhere, select: { id: true } })).map(
    (w) => w.id,
  )
  await prisma.databaseCellValue.deleteMany({ where: { row: { source: { workspace: wsWhere } } } })
  await prisma.databaseRow.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseProperty.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseView.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseSource.deleteMany({ where: { workspace: wsWhere } })
  if (wsIds.length > 0) {
    await prisma.outboxEvent.deleteMany({ where: { workspaceId: { in: wsIds } } })
  }
  await prisma.page.deleteMany({ where })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspace.deleteMany({ where: wsWhere })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed() {
  const user = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'owner',
      firstName: 'O',
      lastName: 'T',
    },
  })
  const ws = await prisma.workspace.create({ data: { name: 'CsvDbWS', createdById: user.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' },
  })
  await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })
  const ctx: MaterializeContext = { prisma, pages: domain.pages, database: domain.database }
  return { user, ws, ctx }
}

const BLUEPRINT = (): CsvDatabaseBlueprint => ({
  sourceKey: 'База.csv',
  title: 'База',
  header: ['Name', 'Status', 'Count'],
  rows: [
    ['Задача А', 'Open', '1'],
    ['Задача Б', 'Done', '2'],
    ['Задача В', 'Open', '3'],
  ],
  rowDocs: new Map([
    [
      'Задача А',
      {
        sourceKey: 'База/Задача А.md',
        baseName: 'Задача А',
        format: 'md' as const,
        bytes: new TextEncoder().encode('# Задача А\n\nтело А'),
      },
    ],
  ]),
})

type Created = Array<{ key: string; pageId: string }>

function makeArgs(
  userId: string,
  workspaceId: string,
  blueprint: CsvDatabaseBlueprint,
  journal: ImportJournal,
  existingMappings: Map<string, string>,
  dbCreated: Created,
  rowsCreated: Created,
) {
  return {
    actorUserId: userId,
    workspaceId,
    parentPageId: null,
    location: 'team' as const,
    blueprint,
    journal,
    existingMappings,
    onRowCreated: async (key: string, pageId: string) => {
      rowsCreated.push({ key, pageId })
    },
    onDatabaseCreated: async (key: string, pageId: string) => {
      dbCreated.push({ key, pageId })
    },
  }
}

describe('materializeCsvDatabase', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('materializes a real database: page, inferred properties, rows, cells, row doc', async () => {
    const { user, ws, ctx } = await seed()
    const journal = new ImportJournal('CSV', 'База.csv')
    const dbCreated: Created = []
    const rowsCreated: Created = []

    const result = await materializeCsvDatabase(
      ctx,
      makeArgs(user.id, ws.id, BLUEPRINT(), journal, new Map(), dbCreated, rowsCreated),
    )
    expect(result.createdRows).toBe(3)

    const dbPage = await prisma.page.findUniqueOrThrow({ where: { id: result.dbPageId } })
    expect(dbPage.title).toBe('База')
    expect(dbPage.type).toBe('DATABASE')
    expect(dbPage.parentId).toBeNull()

    // The seeded «Статус» is replaced by the 2 inferred non-title columns.
    const props = await domain.database.listProperties(user.id, result.dbPageId)
    expect(props).toHaveLength(2)
    expect(props.some((p) => p.name === 'Статус')).toBe(false)
    expect(journal.render()).toContain('Замена свойства по умолчанию')

    const status = props.find((p) => p.name === 'Status')
    const count = props.find((p) => p.name === 'Count')
    expect(status?.type).toBe('SELECT')
    expect(count?.type).toBe('NUMBER')
    const options = (status?.settings as { options: Array<{ id: string; label: string }> }).options
    expect(options.map((o) => o.label).sort()).toEqual(['Done', 'Open'])
    const idByLabel = new Map(options.map((o) => [o.label, o.id]))

    const { rows } = await domain.database.listRows(user.id, {
      pageId: result.dbPageId,
      limit: 100,
    })
    expect(rows).toHaveLength(3)
    const byTitle = new Map(rows.map((r) => [r.title, r]))
    expect(byTitle.get('Задача А')?.cells[status!.id]).toBe(idByLabel.get('Open'))
    expect(byTitle.get('Задача Б')?.cells[status!.id]).toBe(idByLabel.get('Done'))
    expect(byTitle.get('Задача В')?.cells[status!.id]).toBe(idByLabel.get('Open'))
    expect(byTitle.get('Задача А')?.cells[count!.id]).toBe(1)
    expect(byTitle.get('Задача Б')?.cells[count!.id]).toBe(2)
    expect(byTitle.get('Задача В')?.cells[count!.id]).toBe(3)

    // The row doc became the item page content (H1 stripped into the title).
    const itemA = await prisma.page.findUniqueOrThrow({
      where: { id: byTitle.get('Задача А')!.pageId },
    })
    expect(JSON.stringify(itemA.content)).toContain('тело А')
    expect(itemA.contentYjs?.byteLength ?? 0).toBeGreaterThan(0)

    expect(dbCreated).toEqual([{ key: 'База.csv', pageId: result.dbPageId }])
    expect(rowsCreated.map((r) => r.key)).toEqual(['База/Задача А.md', 'База.csv#1', 'База.csv#2'])
  })

  it('resume skips already-imported db page and rows', async () => {
    const { user, ws, ctx } = await seed()
    const dbCreated: Created = []
    const rowsCreated: Created = []
    const first = await materializeCsvDatabase(
      ctx,
      makeArgs(
        user.id,
        ws.id,
        BLUEPRINT(),
        new ImportJournal('CSV', 'База.csv'),
        new Map(),
        dbCreated,
        rowsCreated,
      ),
    )

    const mappings = new Map<string, string>()
    for (const { key, pageId } of [...dbCreated, ...rowsCreated]) mappings.set(key, pageId)

    const dbCreated2: Created = []
    const rowsCreated2: Created = []
    const second = await materializeCsvDatabase(
      ctx,
      makeArgs(
        user.id,
        ws.id,
        BLUEPRINT(),
        new ImportJournal('CSV', 'База.csv'),
        mappings,
        dbCreated2,
        rowsCreated2,
      ),
    )

    expect(second.dbPageId).toBe(first.dbPageId)
    expect(second.createdRows).toBe(0)
    expect(dbCreated2).toEqual([])
    expect(rowsCreated2).toEqual([])

    const props = await domain.database.listProperties(user.id, first.dbPageId)
    expect(props).toHaveLength(2)
    const { rows } = await domain.database.listRows(user.id, { pageId: first.dbPageId, limit: 100 })
    expect(rows).toHaveLength(3)
  })

  it('creates a row per duplicate-titled CSV row; only the first claims the row doc', async () => {
    const { user, ws, ctx } = await seed()
    const journal = new ImportJournal('NOTION', 'База.csv')
    const blueprint: CsvDatabaseBlueprint = {
      sourceKey: 'База.csv',
      title: 'База',
      header: ['Name'],
      rows: [['A'], ['A']],
      rowDocs: new Map([
        [
          'A',
          {
            sourceKey: 'База/A.md',
            baseName: 'A',
            format: 'md' as const,
            bytes: new TextEncoder().encode('# A\n\nтело A'),
          },
        ],
      ]),
    }
    // Mirror production: onRowCreated records into existingMappings (recordMapping).
    const mappings = new Map<string, string>()
    const rowsCreated: Created = []
    const args = makeArgs(user.id, ws.id, blueprint, journal, mappings, [], rowsCreated)
    args.onRowCreated = async (key: string, pageId: string) => {
      mappings.set(key, pageId)
      rowsCreated.push({ key, pageId })
    }

    const result = await materializeCsvDatabase(ctx, args)
    expect(result.createdRows).toBe(2)

    const { rows } = await domain.database.listRows(user.id, {
      pageId: result.dbPageId,
      limit: 100,
    })
    expect(rows).toHaveLength(2)
    // The duplicate falls back to the positional key (no doc-derived key reuse).
    expect(rowsCreated.map((r) => r.key)).toEqual(['База/A.md', 'База.csv#1'])
    expect(journal.warnings.join('\n')).toContain('Дубликат строки «A»')

    // Only the FIRST occurrence received the row doc content.
    const pages = await Promise.all(
      rows.map((r) => prisma.page.findUniqueOrThrow({ where: { id: r.pageId } })),
    )
    expect(pages.filter((p) => JSON.stringify(p.content).includes('тело A'))).toHaveLength(1)
  })

  it('degrades a bad cell value to a journal warning instead of failing', async () => {
    const { user, ws, ctx } = await seed()
    const journal = new ImportJournal('CSV', 'Ссылки.csv')
    // Both values pass the lightweight URL inference regex, so the column is
    // URL-typed; the domain's stricter new URL() + http(s) protocol check then
    // rejects the javascript-flavored value (XSS guard) with a DomainError.
    const blueprint: CsvDatabaseBlueprint = {
      sourceKey: 'Ссылки.csv',
      title: 'Ссылки',
      header: ['Name', 'Link'],
      rows: [
        ['Хорошая', 'https://ok.example/a'],
        ['Плохая', 'https://javascript:alert(1)'],
      ],
    }

    const result = await materializeCsvDatabase(
      ctx,
      makeArgs(user.id, ws.id, blueprint, journal, new Map(), [], []),
    )
    expect(result.createdRows).toBe(2)

    const props = await domain.database.listProperties(user.id, result.dbPageId)
    const link = props.find((p) => p.name === 'Link')
    expect(link?.type).toBe('URL')

    const { rows } = await domain.database.listRows(user.id, {
      pageId: result.dbPageId,
      limit: 100,
    })
    expect(rows).toHaveLength(2)
    const good = rows.find((r) => r.title === 'Хорошая')
    const bad = rows.find((r) => r.title === 'Плохая')
    expect(good?.cells[link!.id]).toBe('https://ok.example/a')
    expect(bad?.cells[link!.id]).toBeUndefined()

    expect(journal.warnings.length).toBeGreaterThan(0)
    expect(journal.warnings.join('\n')).toContain('в колонке «Link» пропущено')
  })
})
