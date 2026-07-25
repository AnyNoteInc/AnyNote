import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { DatabasePropertyType, prisma } from '@repo/db'
import { createDomain } from '@repo/domain'
import { rebuildDeliveries, cancelPendingDeliveries } from '@repo/notifications'

import {
  type AgentDatabaseQueryResult,
  DatabaseReadService,
} from '../../src/apps/mcp/services/database-read.service.js'

const expenseRows = [
  { title: 'Аренда', type: 'expense', amount: 3_000_000, date: '2026-07-02T00:00:00.000Z' },
  { title: 'Продукты', type: 'expense', amount: 845_050, date: '2026-07-05T00:00:00.000Z' },
  { title: 'Зарплата', type: 'income', amount: 12_000_000, date: '2026-07-10T00:00:00.000Z' },
  { title: 'Транспорт', type: 'expense', amount: 154_950, date: '2026-07-12T00:00:00.000Z' },
] as const

type QueryRecord = AgentDatabaseQueryResult['records'][number]

function totalKopecks(records: QueryRecord[], amountPropertyId: string): number {
  return records.reduce(
    (sum, record) => sum + (record.values[amountPropertyId] as { kopecks: number }).kopecks,
    0,
  )
}

describe('DatabaseReadService → @repo/domain → Postgres (integration)', () => {
  const domain = createDomain({
    prisma,
    scheduler: { rebuild: rebuildDeliveries, cancel: cancelPendingDeliveries },
  })
  const databaseRead = new DatabaseReadService(domain)

  let workspaceId: string | undefined
  let userId: string | undefined
  let pageId: string
  let sourceId: string
  let typePropertyId: string
  let amountPropertyId: string
  let datePropertyId: string
  let expenseOptionId: string
  let incomeOptionId: string
  let incomeViewId: string

  async function queryAll(
    filter: unknown,
    limit = 2,
  ): Promise<{ pages: AgentDatabaseQueryResult[]; records: QueryRecord[] }> {
    const pages: AgentDatabaseQueryResult[] = []
    let cursor: string | undefined

    do {
      const page = await databaseRead.query({
        userId: userId!,
        workspaceId: workspaceId!,
        pageId,
        filter,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      })
      pages.push(page)
      cursor = page.nextCursor ?? undefined
    } while (pages.at(-1)?.nextCursor !== null)

    return { pages, records: pages.flatMap((page) => page.records) }
  }

  beforeEach(async () => {
    workspaceId = undefined
    userId = undefined

    const workspace = await prisma.workspace.create({
      data: { name: 'database-query-int' },
    })
    workspaceId = workspace.id

    const user = await prisma.user.create({
      data: {
        name: 'Database Query User',
        firstName: 'Database',
        lastName: 'Query',
        email: `database-query-${workspace.id}@example.com`,
        emailVerified: true,
      },
    })
    userId = user.id

    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: 'VIEWER' },
    })

    const page = await prisma.page.create({
      data: {
        workspaceId: workspace.id,
        title: 'Доходы и расходы',
        type: 'DATABASE',
      },
    })
    pageId = page.id

    const source = await prisma.databaseSource.create({
      data: {
        workspaceId: workspace.id,
        pageId: page.id,
        title: 'Доходы и расходы',
      },
    })
    sourceId = source.id

    expenseOptionId = crypto.randomUUID()
    incomeOptionId = crypto.randomUUID()

    const typeProperty = await prisma.databaseProperty.create({
      data: {
        sourceId,
        type: DatabasePropertyType.SELECT,
        name: 'Тип',
        position: 1_000,
        settings: {
          options: [
            { id: expenseOptionId, label: 'Расход', color: 'red' },
            { id: incomeOptionId, label: 'Доход', color: 'green' },
          ],
        },
      },
    })
    typePropertyId = typeProperty.id

    const amountProperty = await prisma.databaseProperty.create({
      data: {
        sourceId,
        type: DatabasePropertyType.MONEY,
        name: 'Сумма',
        position: 2_000,
        settings: { numberFormat: 'currency_rub' },
      },
    })
    amountPropertyId = amountProperty.id

    const dateProperty = await prisma.databaseProperty.create({
      data: {
        sourceId,
        type: DatabasePropertyType.DATE,
        name: 'Дата',
        position: 3_000,
      },
    })
    datePropertyId = dateProperty.id

    const incomeView = await prisma.databaseView.create({
      data: {
        sourceId,
        title: 'Только доходы',
        position: 1_000,
        settings: {
          filters: {
            conjunction: 'and',
            conditions: [{ propertyId: typePropertyId, operator: 'equals', value: incomeOptionId }],
          },
        },
      },
    })
    incomeViewId = incomeView.id

    for (const [index, fixture] of expenseRows.entries()) {
      const rowCreatedById = fixture.title === 'Транспорт' ? null : user.id
      const rowPage = await prisma.page.create({
        data: {
          workspaceId: workspace.id,
          title: fixture.title,
          type: 'TEXT',
          createdById: rowCreatedById,
          updatedById: rowCreatedById,
        },
      })
      const row = await prisma.databaseRow.create({
        data: {
          sourceId,
          pageId: rowPage.id,
          position: (index + 1) * 1_000,
          createdById: rowCreatedById,
          updatedById: rowCreatedById,
        },
      })
      await prisma.databaseCellValue.createMany({
        data: [
          {
            rowId: row.id,
            propertyId: typePropertyId,
            value: fixture.type === 'expense' ? expenseOptionId : incomeOptionId,
          },
          { rowId: row.id, propertyId: amountPropertyId, value: fixture.amount },
          { rowId: row.id, propertyId: datePropertyId, value: fixture.date },
        ],
      })
    }
  })

  afterEach(async () => {
    const createdWorkspaceId = workspaceId
    const createdUserId = userId

    if (createdWorkspaceId !== undefined) {
      await prisma.workspace.deleteMany({ where: { id: createdWorkspaceId } })
    }
    if (createdUserId !== undefined) {
      await prisma.user.deleteMany({ where: { id: createdUserId } })
    }

    if (createdWorkspaceId !== undefined) {
      await expect(
        prisma.workspace.findUnique({ where: { id: createdWorkspaceId } }),
      ).resolves.toBeNull()
    }
    if (createdUserId !== undefined) {
      await expect(prisma.user.findUnique({ where: { id: createdUserId } })).resolves.toBeNull()
    }
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('exposes the approved Title, SELECT, MONEY, and DATE schema', async () => {
    const schema = await databaseRead.getSchema({
      userId: userId!,
      workspaceId: workspaceId!,
      pageId,
    })

    expect(schema.page).toEqual({ id: pageId, title: 'Доходы и расходы' })
    expect(schema.sourceId).toBe(sourceId)
    expect(schema.fields.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'Название', type: 'TITLE' },
      { name: 'Тип', type: 'SELECT' },
      { name: 'Сумма', type: 'MONEY' },
      { name: 'Дата', type: 'DATE' },
    ])
    expect(schema.fields.find(({ id }) => id === typePropertyId)?.options).toEqual([
      { id: expenseOptionId, name: 'Расход' },
      { id: incomeOptionId, name: 'Доход' },
    ])
    expect(schema.fields.find(({ id }) => id === amountPropertyId)?.valueSchema).toEqual({
      type: 'object',
      properties: {
        kopecks: { type: 'integer' },
        rubles: { type: 'number' },
        currency: { type: 'string', const: 'RUB' },
      },
      required: ['kopecks', 'rubles', 'currency'],
      additionalProperties: false,
    })
  })

  it('paginates all-time expenses to exhaustion and ignores an income-only persisted view', async () => {
    const persistedView = await prisma.databaseView.findUniqueOrThrow({
      where: { id: incomeViewId },
    })
    expect(persistedView.settings).toEqual({
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: typePropertyId, operator: 'equals', value: incomeOptionId }],
      },
    })

    const { pages, records } = await queryAll({
      propertyName: 'Тип',
      operator: 'is_any_of',
      value: [expenseOptionId],
    })

    expect(pages).toHaveLength(2)
    expect(pages[0]?.records).toHaveLength(2)
    expect(pages[0]?.nextCursor).not.toBeNull()
    expect(pages[1]?.records).toHaveLength(1)
    expect(pages[1]?.nextCursor).toBeNull()
    expect(records.map((record) => record.title)).toEqual(['Аренда', 'Продукты', 'Транспорт'])
    expect(totalKopecks(records, amountPropertyId)).toBe(4_000_000)
  })

  it('uses half-open date intervals with an explicit timezone', async () => {
    const july = await queryAll(
      {
        propertyName: 'Дата',
        operator: 'between',
        value: {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-08-01T00:00:00.000Z',
        },
      },
      10,
    )
    expect(july.records.map((record) => record.title)).toEqual([
      'Аренда',
      'Продукты',
      'Зарплата',
      'Транспорт',
    ])

    const beforeSalary = await queryAll(
      {
        propertyName: 'Дата',
        operator: 'between',
        value: {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-10T00:00:00.000Z',
        },
      },
      10,
    )
    expect(beforeSalary.records.map((record) => record.title)).toEqual(['Аренда', 'Продукты'])
  })

  it('excludes an inaccessible expense row from both records and the sum', async () => {
    const createdByProperty = await prisma.databaseProperty.create({
      data: {
        sourceId,
        type: DatabasePropertyType.CREATED_BY,
        name: 'Создано',
        position: 4_000,
      },
    })
    await prisma.databasePageAccessRule.create({
      data: {
        sourceId,
        propertyId: createdByProperty.id,
        accessLevel: 'CAN_VIEW',
      },
    })

    const { records } = await queryAll({
      propertyName: 'Тип',
      operator: 'is_any_of',
      value: [expenseOptionId],
    })

    expect(records.map((record) => record.title)).toEqual(['Аренда', 'Продукты'])
    expect(totalKopecks(records, amountPropertyId)).toBe(3_845_050)
  })
})
