import { describe, it, expect, beforeEach, vi } from 'vitest'

import { DomainError } from '../../../src/shared/errors.ts'
import { DatabaseService } from '../../../src/database/services/database.service.ts'
import type { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
import type { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'

// ── Fake UoW — transaction(fn) = fn(), client() unused by service ─────────────
function makeUow(): UnitOfWork {
  return {
    transaction: (fn) => fn(),
    client: vi.fn() as unknown as UnitOfWork['client'],
  }
}

const STATUS_OPTIONS = [
  { id: 'opt-todo', label: 'Не начато', color: '#9CA3AF' },
  { id: 'opt-doing', label: 'В работе', color: '#3B82F6' },
  { id: 'opt-done', label: 'Готово', color: '#10B981' },
]

// ── Repo factory — override individual methods per test ───────────────────────
function makeRepo(overrides: Partial<DatabaseRepository> = {}): DatabaseRepository {
  return {
    findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'u1' })),
    findMembershipRole: vi.fn(async () => 'OWNER'),
    createSource: vi.fn(async (d) => ({ id: 'src1', workspaceId: d.workspaceId, pageId: d.pageId, title: d.title })),
    findSourceByPageId: vi.fn(async () => null),
    findSourceSchemaByPageId: vi.fn(async () => ({
      source: { id: 'src1', workspaceId: 'w1', pageId: 'db-page', title: 'My DB' },
      views: [{ id: 'view1', type: 'TABLE', title: 'Таблица', position: 0, settings: null }],
      properties: [],
    })),
    findRowsPaged: vi.fn(async () => []),
    findRowsForGrouping: vi.fn(async () => []),
    findSourceMetaByPageId: vi.fn(async () => ({ id: 'src1', workspaceId: 'w1', pageId: 'db-page' })),
    listViews: vi.fn(async () => []),
    createView: vi.fn(async (d) => ({ id: 'view1', type: d.type, title: d.title, position: d.position, settings: null })),
    updateView: vi.fn(async (id, d) => ({ id, type: 'TABLE', title: d.title ?? 'V', position: 0, settings: d.settings ?? null })),
    deleteView: vi.fn(async () => undefined),
    findViewById: vi.fn(async () => ({ id: 'view1', sourceId: 'src1' })),
    listProperties: vi.fn(async () => []),
    createProperty: vi.fn(async (d) => ({ id: 'prop1', type: d.type, name: d.name, position: d.position, settings: d.settings ?? null })),
    updateProperty: vi.fn(async (id, d) => ({ id, type: d.type ?? 'TEXT', name: d.name ?? 'P', position: 0, settings: d.settings ?? null })),
    deleteProperty: vi.fn(async () => undefined),
    findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'TEXT', settings: null })),
    reorderProperties: vi.fn(async () => undefined),
    maxPropertyPosition: vi.fn(async () => 0),
    createRow: vi.fn(async (d) => ({ id: 'row1', pageId: d.pageId, position: d.position })),
    findRowsBySource: vi.fn(async () => []),
    findRowById: vi.fn(async () => ({ id: 'row1', sourceId: 'src1', pageId: 'item-page', deletedAt: null })),
    softDeleteRow: vi.fn(async () => undefined),
    restoreRow: vi.fn(async () => undefined),
    reorderRows: vi.fn(async () => undefined),
    maxRowPosition: vi.fn(async () => 0),
    updatePageTitle: vi.fn(async () => undefined),
    updatePageIcon: vi.fn(async () => undefined),
    softDeleteItemPage: vi.fn(async () => undefined),
    restoreItemPage: vi.fn(async () => undefined),
    upsertCellValue: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as DatabaseRepository
}

function makePageRepo(overrides: Partial<PageRepository> = {}): PageRepository {
  return {
    createItemPageTx: vi.fn(async () => ({ id: 'item-page' })),
    ...overrides,
  } as unknown as PageRepository
}

function makeService(
  repo: DatabaseRepository = makeRepo(),
  pageRepo: PageRepository = makePageRepo(),
  uow = makeUow(),
) {
  return new DatabaseService(repo, pageRepo, uow)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('DatabaseService.seedDefaults', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a source titled from the page, a TABLE view "Таблица", and a STATUS property "Статус" with 3 options', async () => {
    const repo = makeRepo()
    await makeService(repo).seedDefaults('db-page', 'w1')

    expect(repo.createSource).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'db-page', workspaceId: 'w1' }),
    )
    expect(repo.createView).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TABLE', title: 'Таблица' }),
    )
    const propCall = (repo.createProperty as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(propCall.type).toBe('STATUS')
    expect(propCall.name).toBe('Статус')
    const options = propCall.settings.options as { label: string }[]
    expect(options.map((o) => o.label)).toEqual(['Не начато', 'В работе', 'Готово'])
    expect(options).toHaveLength(3)
  })

  it('runs inside a single transaction', async () => {
    const repo = makeRepo()
    const txn = vi.fn(async (fn: () => Promise<unknown>) => fn())
    const uow: UnitOfWork = { client: vi.fn() as never, transaction: txn }
    await makeService(repo, makePageRepo(), uow).seedDefaults('db-page', 'w1')
    expect(txn).toHaveBeenCalledOnce()
  })
})

describe('DatabaseService.createProperty', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a property at the next position', async () => {
    const repo = makeRepo({ maxPropertyPosition: vi.fn(async () => 2048) })
    const result = await makeService(repo).createProperty('u1', {
      pageId: 'db-page', type: 'NUMBER', name: 'Оценка',
    })
    expect(result.id).toBe('prop1')
    expect(repo.createProperty).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src1', type: 'NUMBER', name: 'Оценка', position: 3072 }),
    )
  })

  it('throws NOT_FOUND when the page has no source', async () => {
    const repo = makeRepo({ findSourceMetaByPageId: vi.fn(async () => null) })
    await expect(
      makeService(repo).createProperty('u1', { pageId: 'db-page', type: 'TEXT', name: 'X' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('is FORBIDDEN for a VIEWER member who is not the creator', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
    })
    await expect(
      makeService(repo).createProperty('u1', { pageId: 'db-page', type: 'TEXT', name: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('DatabaseService.updateProperty', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renames a property belonging to the source', async () => {
    const repo = makeRepo()
    await makeService(repo).updateProperty('u1', { pageId: 'db-page', id: 'prop1', name: 'Новое' })
    expect(repo.updateProperty).toHaveBeenCalledWith('prop1', expect.objectContaining({ name: 'Новое' }))
  })

  it('throws NOT_FOUND when the property belongs to another source', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'other-src', type: 'TEXT', settings: null })),
    })
    await expect(
      makeService(repo).updateProperty('u1', { pageId: 'db-page', id: 'prop1', name: 'X' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('DatabaseService.deleteProperty', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the property (cells cascade via FK)', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).deleteProperty('u1', { pageId: 'db-page', id: 'prop1' })
    expect(repo.deleteProperty).toHaveBeenCalledWith('prop1')
    expect(result).toEqual({ ok: true })
  })

  it('throws NOT_FOUND when the property belongs to another source', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'other-src', type: 'TEXT', settings: null })),
    })
    await expect(
      makeService(repo).deleteProperty('u1', { pageId: 'db-page', id: 'prop1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('DatabaseService.updateCellValue type validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a non-number value for a NUMBER property', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'NUMBER', settings: null })),
    })
    await expect(
      makeService(repo).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'not-a-number',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a numeric value for a NUMBER property', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'NUMBER', settings: null })),
    })
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 42,
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', 42)
  })

  it('rejects a SELECT option id not in settings.options', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({
        id: 'prop1', sourceId: 'src1', type: 'SELECT', settings: { options: STATUS_OPTIONS },
      })),
    })
    await expect(
      makeService(repo).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'opt-unknown',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a SELECT option id present in settings.options', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({
        id: 'prop1', sourceId: 'src1', type: 'SELECT', settings: { options: STATUS_OPTIONS },
      })),
    })
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'opt-doing',
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', 'opt-doing')
  })

  it('coerces a CHECKBOX value to a boolean', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'CHECKBOX', settings: null })),
    })
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'truthy',
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', true)
  })

  it('clears the cell when value is null', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'TEXT', settings: null })),
    })
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: null,
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', null)
  })

  it('throws NOT_FOUND when the row belongs to another source', async () => {
    const repo = makeRepo({
      findRowById: vi.fn(async () => ({ id: 'row1', sourceId: 'other-src', pageId: 'item-page', deletedAt: null })),
    })
    await expect(
      makeService(repo).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws NOT_FOUND when the row is soft-deleted', async () => {
    const repo = makeRepo({
      findRowById: vi.fn(async () => ({
        id: 'row1', sourceId: 'src1', pageId: 'item-page', deletedAt: new Date('2026-06-08T00:00:00Z'),
      })),
    })
    await expect(
      makeService(repo).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(repo.upsertCellValue).not.toHaveBeenCalled()
  })
})

describe('DatabaseService.getByPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the schema view-model (source, views, properties, systemTitleProperty) with NO rows', async () => {
    const repo = makeRepo({
      findSourceSchemaByPageId: vi.fn(async () => ({
        source: { id: 'src1', workspaceId: 'w1', pageId: 'db-page', title: 'My DB' },
        views: [{ id: 'view1', type: 'TABLE', title: 'Таблица', position: 0, settings: null }],
        properties: [{ id: 'prop1', type: 'STATUS', name: 'Статус', position: 0, settings: { options: STATUS_OPTIONS } }],
      })),
    })
    const vm = await makeService(repo).getByPage('u1', 'db-page')
    expect(vm.source.id).toBe('src1')
    expect(vm.views).toHaveLength(1)
    expect(vm.properties).toHaveLength(1)
    expect(vm.systemTitleProperty.key).toBe('title')
    // getByPage is schema-only — rows moved to listRows (Phase 4A fetch split).
    expect('rows' in vm).toBe(false)
    expect(repo.findRowsPaged).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the page has no source', async () => {
    const repo = makeRepo({ findSourceSchemaByPageId: vi.fn(async () => null) })
    await expect(makeService(repo).getByPage('u1', 'db-page')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('DatabaseService.reorderProperties', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rewrites positions in the given order', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'p-a', type: 'TEXT', name: 'A', position: 0, settings: null },
        { id: 'p-b', type: 'TEXT', name: 'B', position: 1024, settings: null },
        { id: 'p-c', type: 'TEXT', name: 'C', position: 2048, settings: null },
      ]),
    })
    await makeService(repo).reorderProperties('u1', {
      pageId: 'db-page', orderedIds: ['p-a', 'p-b', 'p-c'],
    })
    expect(repo.reorderProperties).toHaveBeenCalledOnce()
    const arg = (repo.reorderProperties as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { id: string; position: number }[]
    expect(arg.map((x) => x.id)).toEqual(['p-a', 'p-b', 'p-c'])
    expect(arg[0]!.position).toBeLessThan(arg[1]!.position)
  })
})

// ── A4: row create/title/delete bridge to item Pages ─────────────────────────

describe('DatabaseService.createRow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates an item Page (via createItemPageTx) and a DatabaseRow, returns { rowId, pageId }', async () => {
    const repo = makeRepo({ maxRowPosition: vi.fn(async () => 1024) })
    const pageRepo = makePageRepo({ createItemPageTx: vi.fn(async () => ({ id: 'item-page-9' })) })
    const result = await makeService(repo, pageRepo).createRow('u1', { pageId: 'db-page' })

    expect(pageRepo.createItemPageTx).toHaveBeenCalledWith('db-page', 'w1', 'u1')
    expect(repo.createRow).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src1', pageId: 'item-page-9', position: 2048, createdById: 'u1' }),
    )
    expect(result).toEqual({ rowId: 'row1', pageId: 'item-page-9' })
  })

  it('runs the page-create + row-create in a single transaction', async () => {
    const repo = makeRepo()
    const txn = vi.fn(async (fn: () => Promise<unknown>) => fn())
    const uow: UnitOfWork = { client: vi.fn() as never, transaction: txn }
    await makeService(repo, makePageRepo(), uow).createRow('u1', { pageId: 'db-page' })
    expect(txn).toHaveBeenCalledOnce()
  })

  it('sets the item Page title when a title is provided', async () => {
    const repo = makeRepo()
    const pageRepo = makePageRepo({ createItemPageTx: vi.fn(async () => ({ id: 'item-page-9' })) })
    await makeService(repo, pageRepo).createRow('u1', { pageId: 'db-page', title: 'Первая' })
    expect(repo.updatePageTitle).toHaveBeenCalledWith('item-page-9', 'Первая', 'u1')
  })

  it('is FORBIDDEN for a VIEWER who is not the creator', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
    })
    await expect(
      makeService(repo).createRow('u1', { pageId: 'db-page' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('DatabaseService.updateRowTitle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes Page.title for the item page', async () => {
    const repo = makeRepo()
    await makeService(repo).updateRowTitle('u1', { pageId: 'db-page', rowId: 'row1', title: 'Новый заголовок' })
    expect(repo.updatePageTitle).toHaveBeenCalledWith('item-page', 'Новый заголовок', 'u1')
  })

  it('writes Page.icon when provided', async () => {
    const repo = makeRepo()
    await makeService(repo).updateRowTitle('u1', { pageId: 'db-page', rowId: 'row1', icon: '🚀' })
    expect(repo.updatePageIcon).toHaveBeenCalledWith('item-page', '🚀', 'u1')
  })

  it('throws NOT_FOUND when the row belongs to another source', async () => {
    const repo = makeRepo({
      findRowById: vi.fn(async () => ({ id: 'row1', sourceId: 'other-src', pageId: 'item-page', deletedAt: null })),
    })
    await expect(
      makeService(repo).updateRowTitle('u1', { pageId: 'db-page', rowId: 'row1', title: 'X' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('DatabaseService.deleteRow / restoreRow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('soft-deletes both the DatabaseRow and the item Page', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).deleteRow('u1', { pageId: 'db-page', rowId: 'row1' })
    expect(repo.softDeleteRow).toHaveBeenCalledWith('row1', 'u1')
    expect(repo.softDeleteItemPage).toHaveBeenCalledWith('item-page', 'u1', 'w1')
    expect(result).toEqual({ ok: true })
  })

  it('restores both the DatabaseRow and the item Page', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).restoreRow('u1', { pageId: 'db-page', rowId: 'row1' })
    expect(repo.restoreRow).toHaveBeenCalledWith('row1', 'u1')
    expect(repo.restoreItemPage).toHaveBeenCalledWith('item-page', 'u1', 'w1')
    expect(result).toEqual({ ok: true })
  })

  it('deleteRow throws NOT_FOUND when the row belongs to another source', async () => {
    const repo = makeRepo({
      findRowById: vi.fn(async () => ({ id: 'row1', sourceId: 'other-src', pageId: 'item-page', deletedAt: null })),
    })
    await expect(
      makeService(repo).deleteRow('u1', { pageId: 'db-page', rowId: 'row1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

function makeRow(id: string, cells: Record<string, unknown> = {}, position = 0) {
  return {
    id,
    pageId: `page-${id}`,
    position,
    page: { title: `Строка ${id}`, icon: null },
    cells: Object.entries(cells).map(([propertyId, value]) => ({ propertyId, value })),
  }
}

describe('DatabaseService.listRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps rows to the view-model shape and returns nextCursor null when under the limit', async () => {
    const repo = makeRepo({
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1',
          pageId: 'item-page',
          position: 0,
          page: { title: 'Строка', icon: '📄' },
          cells: [{ propertyId: 'prop1', value: 'opt-doing' }],
        },
      ]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 100 })
    expect(result.rows[0]).toEqual({
      rowId: 'row1',
      pageId: 'item-page',
      title: 'Строка',
      icon: '📄',
      position: 0,
      cells: { prop1: 'opt-doing' },
    })
    expect(result.nextCursor).toBeNull()
  })

  it('resolves the named view settings and runs the planner (filters reach the repo where)', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => [
        {
          id: 'view1',
          type: 'TABLE',
          title: 'V',
          position: 0,
          settings: {
            filters: {
              conjunction: 'and',
              conditions: [{ propertyId: 'p-text', operator: 'contains', value: 'foo' }],
            },
          },
        },
      ]),
      listProperties: vi.fn(async () => [
        { id: 'p-text', type: 'TEXT', name: 'T', position: 0, settings: null },
      ]),
      findRowsPaged: vi.fn(async () => []),
    })
    await makeService(repo).listRows('u1', { pageId: 'db-page', viewId: 'view1', limit: 100 })
    const arg = (repo.findRowsPaged as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-text', value: { string_contains: 'foo' } } } }],
    })
    expect(arg.sourceId).toBe('src1')
    expect(arg.take).toBe(101) // limit + 1
  })

  it('computes nextCursor from the (limit+1)th row and slices to the limit', async () => {
    // limit 2 → repo returns 3 rows (take=3); service slices to 2, cursor = 3rd row id
    const repo = makeRepo({
      findRowsPaged: vi.fn(async () => [makeRow('a'), makeRow('b'), makeRow('c')]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 2 })
    expect(result.rows.map((r) => r.rowId)).toEqual(['a', 'b'])
    expect(result.nextCursor).toBe('c')
  })

  it('forwards the cursor to the repository', async () => {
    const repo = makeRepo({ findRowsPaged: vi.fn(async () => []) })
    await makeService(repo).listRows('u1', { pageId: 'db-page', cursor: 'row-9', limit: 50 })
    const arg = (repo.findRowsPaged as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.cursor).toBe('row-9')
  })

  it('applies MULTI_SELECT is_any_of post-filters in JS to the fetched rows', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => [
        {
          id: 'view1',
          type: 'TABLE',
          title: 'V',
          position: 0,
          settings: {
            filters: {
              conjunction: 'and',
              conditions: [{ propertyId: 'p-multi', operator: 'is_any_of', value: ['a'] }],
            },
          },
        },
      ]),
      listProperties: vi.fn(async () => [
        { id: 'p-multi', type: 'MULTI_SELECT', name: 'M', position: 0, settings: null },
      ]),
      findRowsPaged: vi.fn(async () => [
        makeRow('r1', { 'p-multi': ['a', 'b'] }),
        makeRow('r2', { 'p-multi': ['c'] }),
        makeRow('r3', {}),
      ]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', viewId: 'view1', limit: 100 })
    expect(result.rows.map((r) => r.rowId)).toEqual(['r1'])
  })

  it('applies MULTI_SELECT is_none_of post-filters (excludes matching rows)', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => [
        {
          id: 'view1',
          type: 'TABLE',
          title: 'V',
          position: 0,
          settings: {
            filters: {
              conjunction: 'and',
              conditions: [{ propertyId: 'p-multi', operator: 'is_none_of', value: ['a'] }],
            },
          },
        },
      ]),
      listProperties: vi.fn(async () => [
        { id: 'p-multi', type: 'MULTI_SELECT', name: 'M', position: 0, settings: null },
      ]),
      findRowsPaged: vi.fn(async () => [
        makeRow('r1', { 'p-multi': ['a'] }),
        makeRow('r2', { 'p-multi': ['c'] }),
      ]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', viewId: 'view1', limit: 100 })
    expect(result.rows.map((r) => r.rowId)).toEqual(['r2'])
  })
})

describe('DatabaseService.listGroupedRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('buckets rows by the groupBy property options plus a null (empty) group, sorted by position', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => [
        {
          id: 'board1',
          type: 'BOARD',
          title: 'Доска',
          position: 0,
          settings: { groupBy: { propertyId: 'p-status' } },
        },
      ]),
      listProperties: vi.fn(async () => [
        {
          id: 'p-status',
          type: 'STATUS',
          name: 'Статус',
          position: 0,
          settings: { options: STATUS_OPTIONS },
        },
      ]),
      findRowsForGrouping: vi.fn(async () => [
        makeRow('r2', { 'p-status': 'opt-doing' }, 2048),
        makeRow('r1', { 'p-status': 'opt-doing' }, 1024),
        makeRow('r3', {}), // no status → empty group
      ]),
    })
    const result = await makeService(repo).listGroupedRows('u1', { pageId: 'db-page', viewId: 'board1' })
    const byKey = Object.fromEntries(result.groups.map((g) => [g.key, g]))
    // one bucket per option + a null group
    expect(result.groups.map((g) => g.key)).toEqual(['opt-todo', 'opt-doing', 'opt-done', null])
    expect(byKey['opt-doing']!.rows.map((r) => r.rowId)).toEqual(['r1', 'r2']) // sorted by position
    expect(byKey['opt-doing']!.label).toBe('В работе')
    expect(byKey['opt-todo']!.rows).toEqual([])
    const emptyGroup = result.groups.find((g) => g.key === null)!
    expect(emptyGroup.rows.map((r) => r.rowId)).toEqual(['r3'])
    expect(emptyGroup.color).toBeNull()
  })

  it('throws BAD_REQUEST when the view has no groupBy', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => [
        { id: 'board1', type: 'BOARD', title: 'Доска', position: 0, settings: {} },
      ]),
    })
    await expect(
      makeService(repo).listGroupedRows('u1', { pageId: 'db-page', viewId: 'board1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('DatabaseService.createView default settings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('seeds groupBy = first STATUS/SELECT property for a BOARD view', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => []),
      listProperties: vi.fn(async () => [
        { id: 'p-text', type: 'TEXT', name: 'T', position: 0, settings: null },
        { id: 'p-status', type: 'STATUS', name: 'S', position: 1024, settings: null },
      ]),
    })
    await makeService(repo).createView('u1', { pageId: 'db-page', type: 'BOARD', title: 'Доска' })
    const arg = (repo.createView as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.type).toBe('BOARD')
    expect(arg.settings).toEqual({ groupBy: { propertyId: 'p-status' } })
  })

  it('seeds layout.datePropertyId = first DATE property for a CALENDAR view', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => []),
      listProperties: vi.fn(async () => [
        { id: 'p-date', type: 'DATE', name: 'D', position: 0, settings: null },
      ]),
    })
    await makeService(repo).createView('u1', { pageId: 'db-page', type: 'CALENDAR', title: 'Календарь' })
    const arg = (repo.createView as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.settings).toEqual({ layout: { datePropertyId: 'p-date' } })
  })

  it('seeds empty settings for a TABLE view', async () => {
    const repo = makeRepo({ listViews: vi.fn(async () => []), listProperties: vi.fn(async () => []) })
    await makeService(repo).createView('u1', { pageId: 'db-page', type: 'TABLE', title: 'Таблица' })
    const arg = (repo.createView as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.settings).toEqual({})
  })

  it('leaves BOARD groupBy unset when no STATUS/SELECT property exists', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => []),
      listProperties: vi.fn(async () => [
        { id: 'p-text', type: 'TEXT', name: 'T', position: 0, settings: null },
      ]),
    })
    await makeService(repo).createView('u1', { pageId: 'db-page', type: 'BOARD', title: 'Доска' })
    const arg = (repo.createView as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.settings).toEqual({})
  })
})

describe('DatabaseService.duplicateView', () => {
  beforeEach(() => vi.clearAllMocks())

  it('copies title + " (копия)", type, and settings at the next position', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => [
        {
          id: 'view1',
          type: 'BOARD',
          title: 'Доска',
          position: 1024,
          settings: { groupBy: { propertyId: 'p-status' } },
        },
      ]),
    })
    await makeService(repo).duplicateView('u1', { pageId: 'db-page', viewId: 'view1' })
    const arg = (repo.createView as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.title).toBe('Доска (копия)')
    expect(arg.type).toBe('BOARD')
    expect(arg.settings).toEqual({ groupBy: { propertyId: 'p-status' } })
    expect(arg.position).toBeGreaterThan(1024)
  })

  it('throws NOT_FOUND when the view does not belong to the source', async () => {
    const repo = makeRepo({ listViews: vi.fn(async () => []) })
    await expect(
      makeService(repo).duplicateView('u1', { pageId: 'db-page', viewId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('is FORBIDDEN for a VIEWER who is not the creator', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
    })
    await expect(
      makeService(repo).duplicateView('u1', { pageId: 'db-page', viewId: 'view1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
