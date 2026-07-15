import { describe, it, expect, beforeEach, vi } from 'vitest'

import { DatabaseService } from '../../../src/database/services/database.service.ts'
import { MAX_BOARD_ROWS } from '../../../src/database/dto/database.dto.ts'
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
    upsertFileCellValue: vi.fn(async () => undefined),
    // Rich-property (Phase 4B) repo surface.
    replaceRelationLinks: vi.fn(async () => undefined),
    findRelationLinks: vi.fn(async () => new Map()),
    findRelationLinksForProperties: vi.fn(async () => new Map()),
    findRowsByIds: vi.fn(async () => []),
    findCellsForRows: vi.fn(async () => []),
    isWorkspaceMember: vi.fn(async () => true),
    findLinkableRows: vi.fn(async () => []),
    findUserNames: vi.fn(async () => new Map()),
    findRowWorkspaceIds: vi.fn(async () => new Map()),
    findSourceWorkspaceId: vi.fn(async () => 'w1'),
    // Phase 4C: access-rule + resolver-context surface.
    listAccessRules: vi.fn(async () => []),
    findEnabledAccessRules: vi.fn(async () => []),
    createAccessRule: vi.fn(async (d) => ({ id: 'rule1', propertyId: d.propertyId, accessLevel: d.accessLevel, enabled: true })),
    updateAccessRule: vi.fn(async (d) => ({ id: d.id, propertyId: 'prop1', accessLevel: d.accessLevel ?? 'CAN_VIEW', enabled: d.enabled ?? true })),
    deleteAccessRule: vi.fn(async () => undefined),
    findAccessRuleById: vi.fn(async () => ({ id: 'rule1', sourceId: 'src1' })),
    setStructureLocked: vi.fn(async () => undefined),
    findWorkspaceRole: vi.fn(async () => 'OWNER'),
    isSourcePageCreatedBy: vi.fn(async () => true),
    findItemPageShareLevel: vi.fn(async () => null),
    findSourceWithLockByPageId: vi.fn(async () => ({
      id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'u1',
    })),
    findRowForAccess: vi.fn(async () => ({
      id: 'row1', sourceId: 'src1', rowCreatedById: 'u1', cellsByProperty: new Map(),
    })),
    findRowsAccessMetaByIds: vi.fn(async () => []),
    findEnabledAccessRulesForSources: vi.fn(async () => new Map()),
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
    // createProperty now resolves the source via findSourceWithLockByPageId (the
    // structure-edit guard); a missing source there is the NOT_FOUND path.
    const repo = makeRepo({
      findSourceMetaByPageId: vi.fn(async () => null),
      findSourceWithLockByPageId: vi.fn(async () => null),
    })
    await expect(
      makeService(repo).createProperty('u1', { pageId: 'db-page', type: 'TEXT', name: 'X' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'База данных не найдена для этой страницы',
    })
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

  it('rejects a non-finite NUMBER (Infinity would JSON-stringify to null = data loss)', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'NUMBER', settings: null })),
    })
    await expect(
      makeService(repo).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: Infinity,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(repo.upsertCellValue).not.toHaveBeenCalled()
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

  it('stores a FILE value as an ordered array of file ids', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'FILE', settings: null })),
    })
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: ['file-a', 'file-b'],
    })
    expect(repo.upsertFileCellValue).toHaveBeenCalledWith('row1', 'prop1', ['file-a', 'file-b'])
    expect(repo.upsertCellValue).not.toHaveBeenCalled()
  })

  it('accepts an empty FILE array as the canonical empty value', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'FILE', settings: null })),
    })
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: [],
    })
    expect(repo.upsertFileCellValue).toHaveBeenCalledWith('row1', 'prop1', [])
    expect(repo.upsertCellValue).not.toHaveBeenCalled()
  })

  it.each([
    'legacy-file-id',
    '',
    42,
    null,
    ['file-a', 42],
    ['file-a', ''],
    ['file-a', '   '],
  ])('rejects a non-array or invalid FILE value %#', async (value) => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'FILE', settings: null })),
    })
    await expect(
      makeService(repo).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Ожидался список файлов' })
    expect(repo.upsertCellValue).not.toHaveBeenCalled()
    expect(repo.upsertFileCellValue).not.toHaveBeenCalled()
  })

  it('rejects duplicate FILE ids instead of silently deduplicating', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'FILE', settings: null })),
    })
    await expect(
      makeService(repo).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: ['file-a', 'file-a'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Файлы не должны повторяться' })
    expect(repo.upsertCellValue).not.toHaveBeenCalled()
    expect(repo.upsertFileCellValue).not.toHaveBeenCalled()
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

  it('computes nextCursor from the last returned row and slices to the limit', async () => {
    // limit 2 → repo returns 3 rows (take=3, the 3rd is the has-more probe);
    // service slices to 2 and sets the keyset cursor to the LAST returned row
    // ('b'). findRowsPaged re-anchors with `cursor: { id } , skip: 1`, so the next
    // page resumes at the row after 'b' (the probe row 'c') — using 'c' here would
    // skip it.
    const repo = makeRepo({
      findRowsPaged: vi.fn(async () => [makeRow('a'), makeRow('b'), makeRow('c')]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 2 })
    expect(result.rows.map((r) => r.rowId)).toEqual(['a', 'b'])
    expect(result.nextCursor).toBe('b')
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

  it('applies a RELATION is_any_of post-filter using the row link sets', async () => {
    const repo = makeRepo({
      listViews: vi.fn(async () => [
        {
          id: 'view1', type: 'TABLE', title: 'V', position: 0,
          settings: {
            filters: {
              conjunction: 'and',
              conditions: [{ propertyId: 'p-rel', operator: 'is_any_of', value: ['t1'] }],
            },
          },
        },
      ]),
      listProperties: vi.fn(async () => [
        { id: 'p-rel', type: 'RELATION', name: 'Связь', position: 0, settings: { relation: { targetSourceId: 'src-t' } } },
      ]),
      findRowsPaged: vi.fn(async () => [
        { id: 'r1', pageId: 'p-r1', position: 0, createdAt: new Date(), createdById: 'u1', updatedAt: new Date(), updatedById: 'u1', page: { title: 'R1', icon: null }, cells: [] },
        { id: 'r2', pageId: 'p-r2', position: 1, createdAt: new Date(), createdById: 'u1', updatedAt: new Date(), updatedById: 'u1', page: { title: 'R2', icon: null }, cells: [] },
      ]),
      // r1 links to t1 (matches); r2 links to t9 (excluded).
      findRelationLinks: vi.fn(async () => new Map([['r1', ['t1']], ['r2', ['t9']]])),
      findRelationLinksForProperties: vi.fn(async () => new Map([['p-rel', new Map([['r1', ['t1']], ['r2', ['t9']]])]])),
      findRowsByIds: vi.fn(async () => [
        { id: 't1', pageId: 'pt1', title: 'T1', icon: null },
        { id: 't9', pageId: 'pt9', title: 'T9', icon: null },
      ]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', viewId: 'view1', limit: 100 })
    expect(result.rows.map((r) => r.rowId)).toEqual(['r1'])
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

  it('caps the board at MAX_BOARD_ROWS and flags truncated when more rows match', async () => {
    // The repo returns MAX_BOARD_ROWS + 1 rows (the over-fetch probe), all in one
    // bucket. The board must over-fetch by one, slice to the cap, and report it.
    const many = Array.from({ length: MAX_BOARD_ROWS + 1 }, (_, i) =>
      makeRow(`r${i}`, { 'p-status': 'opt-doing' }, i),
    )
    const fetchSpy = vi.fn(async () => many)
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
      findRowsForGrouping: fetchSpy,
    })
    const result = await makeService(repo).listGroupedRows('u1', {
      pageId: 'db-page',
      viewId: 'board1',
    })
    // (a) the repo was asked to fetch with a cap of MAX_BOARD_ROWS + 1
    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ take: MAX_BOARD_ROWS + 1 }))
    // (b) truncation is honest
    expect(result.truncated).toBe(true)
    // (c) the board was sliced to exactly MAX_BOARD_ROWS rows across all groups
    const total = result.groups.reduce((n, g) => n + g.rows.length, 0)
    expect(total).toBe(MAX_BOARD_ROWS)
  })

  it('truncated is false when exactly MAX_BOARD_ROWS match (pins the off-by-one)', async () => {
    const exactly = Array.from({ length: MAX_BOARD_ROWS }, (_, i) =>
      makeRow(`r${i}`, { 'p-status': 'opt-doing' }, i),
    )
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
      findRowsForGrouping: vi.fn(async () => exactly),
    })
    const result = await makeService(repo).listGroupedRows('u1', {
      pageId: 'db-page',
      viewId: 'board1',
    })
    expect(result.truncated).toBe(false)
    const total = result.groups.reduce((n, g) => n + g.rows.length, 0)
    expect(total).toBe(MAX_BOARD_ROWS)
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

// ── C3: rich cell validation ─────────────────────────────────────────────────

describe('DatabaseService.updateCellValue — read-only types', () => {
  beforeEach(() => vi.clearAllMocks())

  for (const type of ['FORMULA', 'ROLLUP', 'CREATED_TIME', 'CREATED_BY', 'LAST_EDITED_TIME', 'LAST_EDITED_BY']) {
    it(`rejects a write to a ${type} property (read-only)`, async () => {
      const repo = makeRepo({
        findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type, settings: null })),
      })
      await expect(
        makeService(repo).updateCellValue('u1', {
          pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'x',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      expect(repo.upsertCellValue).not.toHaveBeenCalled()
    })
  }
})

describe('DatabaseService.updateCellValue — PERSON', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a workspace-member userId', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'PERSON', settings: null })),
      isWorkspaceMember: vi.fn(async () => true),
    })
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'member-id',
    })
    expect(repo.isWorkspaceMember).toHaveBeenCalledWith('member-id', 'w1')
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', 'member-id')
  })

  it('rejects a non-member userId', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'PERSON', settings: null })),
      isWorkspaceMember: vi.fn(async () => false),
    })
    await expect(
      makeService(repo).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'stranger',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(repo.upsertCellValue).not.toHaveBeenCalled()
  })
})

describe('DatabaseService.updateCellValue — URL / EMAIL / PHONE', () => {
  beforeEach(() => vi.clearAllMocks())

  function repoFor(type: string) {
    return makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type, settings: null })),
    })
  }

  it('accepts a valid URL', async () => {
    const repo = repoFor('URL')
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'https://example.com/x',
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', 'https://example.com/x')
  })

  it('rejects an invalid URL', async () => {
    await expect(
      makeService(repoFor('URL')).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'not a url',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects a javascript: URL (XSS scheme) even though new URL() parses it', async () => {
    await expect(
      makeService(repoFor('URL')).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'javascript:alert(1)',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects a data: URL', async () => {
    await expect(
      makeService(repoFor('URL')).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'data:text/html,<script>1</script>',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a valid EMAIL', async () => {
    const repo = repoFor('EMAIL')
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'a@b.co',
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', 'a@b.co')
  })

  it('rejects an invalid EMAIL', async () => {
    await expect(
      makeService(repoFor('EMAIL')).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a valid PHONE and rejects garbage', async () => {
    const repo = repoFor('PHONE')
    await makeService(repo).updateCellValue('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: '+7 (495) 123-45-67',
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', '+7 (495) 123-45-67')
    await expect(
      makeService(repoFor('PHONE')).updateCellValue('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'abc',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('DatabaseService.setRelationLinks', () => {
  beforeEach(() => vi.clearAllMocks())

  function relProp(settings: unknown = { relation: { targetSourceId: 'src-target' } }) {
    return vi.fn(async () => ({ id: 'prop-rel', sourceId: 'src1', type: 'RELATION', settings }))
  }

  it('replaces the link set for same-workspace targets', async () => {
    const repo = makeRepo({
      findPropertyById: relProp(),
      findRowWorkspaceIds: vi.fn(async () => new Map([['t1', 'w1'], ['t2', 'w1']])),
    })
    await makeService(repo).setRelationLinks('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop-rel', targetRowIds: ['t1', 't2'],
    })
    expect(repo.replaceRelationLinks).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-rel', rowId: 'row1', targetRowIds: ['t1', 't2'] }),
    )
  })

  it('rejects when a target row is in another workspace', async () => {
    const repo = makeRepo({
      findPropertyById: relProp(),
      findRowWorkspaceIds: vi.fn(async () => new Map([['t1', 'w1'], ['t2', 'other-ws']])),
    })
    await expect(
      makeService(repo).setRelationLinks('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop-rel', targetRowIds: ['t1', 't2'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(repo.replaceRelationLinks).not.toHaveBeenCalled()
  })

  it('rejects a target row that does not exist (absent from the workspace map)', async () => {
    const repo = makeRepo({
      findPropertyById: relProp(),
      findRowWorkspaceIds: vi.fn(async () => new Map([['t1', 'w1']])),
    })
    await expect(
      makeService(repo).setRelationLinks('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop-rel', targetRowIds: ['t1', 'ghost'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects when the property is not a RELATION', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'TEXT', settings: null })),
    })
    await expect(
      makeService(repo).setRelationLinks('u1', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', targetRowIds: ['t1'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('syncs the back-relation mirror on the target rows when configured', async () => {
    const repo = makeRepo({
      findPropertyById: relProp({ relation: { targetSourceId: 'src-target', backRelationPropertyId: 'prop-back' } }),
      findRowWorkspaceIds: vi.fn(async () => new Map([['t1', 'w1']])),
      // Existing mirror links: t1 already had no mirror; after sync it should include row1.
      findRelationLinks: vi.fn(async () => new Map<string, string[]>()),
    })
    await makeService(repo).setRelationLinks('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop-rel', targetRowIds: ['t1'],
    })
    // The forward link set is replaced...
    expect(repo.replaceRelationLinks).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-rel', rowId: 'row1', targetRowIds: ['t1'] }),
    )
    // ...and a mirror link set on the target row (prop-back, t1) is replaced to include row1.
    expect(repo.replaceRelationLinks).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-back', rowId: 't1', targetRowIds: expect.arrayContaining(['row1']) }),
    )
  })

  it('removes the row from a target that is no longer linked (back-relation prune)', async () => {
    const repo = makeRepo({
      findPropertyById: relProp({ relation: { targetSourceId: 'src-target', backRelationPropertyId: 'prop-back' } }),
      findRowWorkspaceIds: vi.fn(async () => new Map([['t-keep', 'w1']])),
      // The forward links currently point at t-keep AND t-drop; t-drop is dropped now.
      findRelationLinks: vi.fn(async (propertyId: string, rowIds: string[]) => {
        if (propertyId === 'prop-rel') return new Map([['row1', ['t-keep', 't-drop']]])
        // mirror lookups: t-drop currently mirrors row1
        const m = new Map<string, string[]>()
        for (const id of rowIds) m.set(id, id === 't-drop' ? ['row1'] : [])
        return m
      }),
    })
    await makeService(repo).setRelationLinks('u1', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop-rel', targetRowIds: ['t-keep'],
    })
    // The mirror on t-drop is rewritten WITHOUT row1.
    const calls = (repo.replaceRelationLinks as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    const dropCall = calls.find((c: { rowId: string }) => c.rowId === 't-drop')
    expect(dropCall).toBeDefined()
    expect(dropCall.targetRowIds).not.toContain('row1')
  })
})

describe('DatabaseService.listLinkableRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the target-source rows for the picker', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({
        id: 'prop-rel', sourceId: 'src1', type: 'RELATION', settings: { relation: { targetSourceId: 'src-target' } },
      })),
      findLinkableRows: vi.fn(async () => [{ id: 't1', pageId: 'p-t1', title: 'Цель' }]),
    })
    const out = await makeService(repo).listLinkableRows('u1', {
      pageId: 'db-page', propertyId: 'prop-rel', query: 'Це',
    })
    expect(repo.findLinkableRows).toHaveBeenCalledWith('src-target', 'Це')
    expect(out).toEqual([{ id: 't1', pageId: 'p-t1', title: 'Цель' }])
  })

  it('throws BAD_REQUEST when the property is not a configured RELATION', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'TEXT', settings: null })),
    })
    await expect(
      makeService(repo).listLinkableRows('u1', { pageId: 'db-page', propertyId: 'prop1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('DatabaseService.createProperty — settings validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a FORMULA that parses', async () => {
    const repo = makeRepo()
    await makeService(repo).createProperty('u1', {
      pageId: 'db-page', type: 'FORMULA', name: 'F', settings: { formula: 'concat("a","b")' },
    })
    expect(repo.createProperty).toHaveBeenCalled()
  })

  it('rejects a FORMULA with a syntax error', async () => {
    const repo = makeRepo()
    await expect(
      makeService(repo).createProperty('u1', {
        pageId: 'db-page', type: 'FORMULA', name: 'F', settings: { formula: 'concat("a",' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a RELATION whose targetSourceId is a source in the workspace', async () => {
    const repo = makeRepo({ findSourceWorkspaceId: vi.fn(async () => 'w1') })
    await makeService(repo).createProperty('u1', {
      pageId: 'db-page', type: 'RELATION', name: 'R', settings: { relation: { targetSourceId: 'src-target' } },
    })
    expect(repo.createProperty).toHaveBeenCalled()
  })

  it('rejects a RELATION whose targetSourceId is in another workspace', async () => {
    const repo = makeRepo({ findSourceWorkspaceId: vi.fn(async () => 'other-ws') })
    await expect(
      makeService(repo).createProperty('u1', {
        pageId: 'db-page', type: 'RELATION', name: 'R', settings: { relation: { targetSourceId: 'src-x' } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects a RELATION whose targetSourceId does not exist', async () => {
    const repo = makeRepo({ findSourceWorkspaceId: vi.fn(async () => null) })
    await expect(
      makeService(repo).createProperty('u1', {
        pageId: 'db-page', type: 'RELATION', name: 'R', settings: { relation: { targetSourceId: 'ghost' } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a ROLLUP referencing a RELATION property + a valid target property', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'prop-rel', type: 'RELATION', name: 'R', position: 0, settings: { relation: { targetSourceId: 'src-target' } } },
      ]),
      // The target source has property p-amt.
      findLinkableRows: vi.fn(async () => []),
    })
    // Stub the target-source property lookup via listProperties override is not enough;
    // the service uses a dedicated target-properties fetch. We allow '__title__' here.
    await makeService(repo).createProperty('u1', {
      pageId: 'db-page', type: 'ROLLUP', name: 'Roll',
      settings: { rollup: { relationPropertyId: 'prop-rel', targetPropertyId: '__title__', aggregation: 'count_all' } },
    })
    expect(repo.createProperty).toHaveBeenCalled()
  })

  it('rejects a ROLLUP whose relationPropertyId is not a RELATION on this source', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'prop-text', type: 'TEXT', name: 'T', position: 0, settings: null },
      ]),
    })
    await expect(
      makeService(repo).createProperty('u1', {
        pageId: 'db-page', type: 'ROLLUP', name: 'Roll',
        settings: { rollup: { relationPropertyId: 'prop-text', targetPropertyId: '__title__', aggregation: 'count_all' } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('DatabaseService.listRows — computed cells', () => {
  beforeEach(() => vi.clearAllMocks())

  it('augments rows with a FORMULA computed cell', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'p-name', type: 'TEXT', name: 'Название', position: 0, settings: null },
        { id: 'p-f', type: 'FORMULA', name: 'Привет', position: 1024, settings: { formula: 'concat(prop("Название"), "!")' } },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1', pageId: 'item-page', position: 0,
          createdAt: new Date('2026-01-01T00:00:00Z'), createdById: 'u1',
          updatedAt: new Date('2026-01-02T00:00:00Z'), updatedById: 'u1',
          page: { title: 'мир', icon: null },
          cells: [{ propertyId: 'p-name', value: 'мир' }],
        },
      ]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 100 })
    expect(result.rows[0]!.cells['p-name']).toBe('мир')
    expect(result.rows[0]!.cells['p-f']).toBe('мир!')
  })

  it('normalizes only persisted FILE cells before formulas read them', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'p-file', type: 'FILE', name: 'Файл', position: 0, settings: null },
        { id: 'p-text', type: 'TEXT', name: 'Текст', position: 1024, settings: null },
        {
          id: 'p-file-length',
          type: 'FORMULA',
          name: 'Длина файла',
          position: 2048,
          settings: { formula: 'length(prop("Файл"))' },
        },
        {
          id: 'p-text-length',
          type: 'FORMULA',
          name: 'Длина текста',
          position: 3072,
          settings: { formula: 'length(prop("Текст"))' },
        },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'legacy-row',
          pageId: 'legacy-page',
          position: 0,
          createdAt: new Date(),
          createdById: 'u1',
          updatedAt: new Date(),
          updatedById: 'u1',
          page: { title: 'Legacy', icon: null },
          cells: [
            { propertyId: 'p-file', value: 'legacy-file-id' },
            { propertyId: 'p-text', value: 'four' },
          ],
        },
        {
          id: 'canonical-row',
          pageId: 'canonical-page',
          position: 1024,
          createdAt: new Date(),
          createdById: 'u1',
          updatedAt: new Date(),
          updatedById: 'u1',
          page: { title: 'Canonical', icon: null },
          cells: [
            { propertyId: 'p-file', value: ['legacy-file-id'] },
            { propertyId: 'p-text', value: 'four' },
          ],
        },
      ]),
    })

    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 100 })

    expect(result.rows.map((row) => row.cells['p-file-length'])).toEqual([1, 1])
    expect(result.rows.map((row) => row.cells['p-file'])).toEqual([
      ['legacy-file-id'],
      ['legacy-file-id'],
    ])
    expect(result.rows.map((row) => row.cells['p-text'])).toEqual(['four', 'four'])
    expect(result.rows.map((row) => row.cells['p-text-length'])).toEqual([4, 4])
  })

  it('augments rows with a ROLLUP count over relation links', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'p-rel', type: 'RELATION', name: 'Связь', position: 0, settings: { relation: { targetSourceId: 'src-t' } } },
        { id: 'p-roll', type: 'ROLLUP', name: 'Кол', position: 1024, settings: { rollup: { relationPropertyId: 'p-rel', targetPropertyId: '__title__', aggregation: 'count_all' } } },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1', pageId: 'item-page', position: 0,
          createdAt: new Date(), createdById: 'u1', updatedAt: new Date(), updatedById: 'u1',
          page: { title: 'A', icon: null }, cells: [],
        },
      ]),
      findRelationLinksForProperties: vi.fn(async () => new Map([['p-rel', new Map([['row1', ['t1', 't2']]])]])),
      findRowsByIds: vi.fn(async () => [
        { id: 't1', pageId: 'pt1', title: 'T1', icon: null },
        { id: 't2', pageId: 'pt2', title: 'T2', icon: null },
      ]),
      findCellsForRows: vi.fn(async () => []),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 100 })
    expect(result.rows[0]!.cells['p-roll']).toBe(2)
    // RELATION cell becomes chips.
    expect(result.rows[0]!.cells['p-rel']).toHaveLength(2)
  })

  it('uses target property types to normalize only FILE values before rollup aggregation', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        {
          id: 'p-rel',
          type: 'RELATION',
          name: 'Связь',
          position: 0,
          settings: { relation: { targetSourceId: 'other-source' } },
        },
        {
          id: 'p-roll-file',
          type: 'ROLLUP',
          name: 'Файлы',
          position: 1024,
          settings: {
            rollup: {
              relationPropertyId: 'p-rel',
              targetPropertyId: 'target-file',
              aggregation: 'show_original',
            },
          },
        },
        {
          id: 'p-roll-text',
          type: 'ROLLUP',
          name: 'Тексты',
          position: 2048,
          settings: {
            rollup: {
              relationPropertyId: 'p-rel',
              targetPropertyId: 'target-text',
              aggregation: 'show_original',
            },
          },
        },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1',
          pageId: 'item-page',
          position: 0,
          createdAt: new Date(),
          createdById: 'u1',
          updatedAt: new Date(),
          updatedById: 'u1',
          page: { title: 'A', icon: null },
          cells: [],
        },
      ]),
      findRelationLinksForProperties: vi.fn(
        async () => new Map([['p-rel', new Map([['row1', ['target-1', 'target-2']]])]]),
      ),
      findRowsByIds: vi.fn(async () => [
        { id: 'target-1', pageId: 'target-page-1', title: 'T1', icon: null },
        { id: 'target-2', pageId: 'target-page-2', title: 'T2', icon: null },
      ]),
      findCellsForRows: vi.fn(async () => [
        {
          rowId: 'target-1',
          propertyId: 'target-file',
          propertyType: 'FILE',
          value: 'legacy-file-id',
        },
        {
          rowId: 'target-2',
          propertyId: 'target-file',
          propertyType: 'FILE',
          value: ['legacy-file-id'],
        },
        {
          rowId: 'target-1',
          propertyId: 'target-text',
          propertyType: 'TEXT',
          value: 'first',
        },
        {
          rowId: 'target-2',
          propertyId: 'target-text',
          propertyType: 'TEXT',
          value: 'second',
        },
      ]),
    })

    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 100 })

    expect(repo.findCellsForRows).toHaveBeenCalledWith(['target-1', 'target-2'])
    expect(result.rows[0]!.cells['p-roll-file']).toEqual([
      ['legacy-file-id'],
      ['legacy-file-id'],
    ])
    expect(result.rows[0]!.cells['p-roll-text']).toEqual(['first', 'second'])
  })

  it('resolves CREATED_BY metadata to the user name', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'p-cb', type: 'CREATED_BY', name: 'Автор', position: 0, settings: null },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1', pageId: 'item-page', position: 0,
          createdAt: new Date('2026-01-01T00:00:00Z'), createdById: 'author-id',
          updatedAt: new Date('2026-01-02T00:00:00Z'), updatedById: 'author-id',
          page: { title: 'A', icon: null }, cells: [],
        },
      ]),
      findUserNames: vi.fn(async () => new Map([['author-id', 'Автор Тест']])),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 100 })
    expect(result.rows[0]!.cells['p-cb']).toBe('Автор Тест')
  })

  it('does NOT batch-fetch relation/metadata when there are no computed properties', async () => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'p-text', type: 'TEXT', name: 'T', position: 0, settings: null },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1', pageId: 'item-page', position: 0,
          createdAt: new Date(), createdById: 'u1', updatedAt: new Date(), updatedById: 'u1',
          page: { title: 'A', icon: null }, cells: [{ propertyId: 'p-text', value: 'x' }],
        },
      ]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 100 })
    expect(result.rows[0]!.cells['p-text']).toBe('x')
    expect(repo.findRelationLinksForProperties).not.toHaveBeenCalled()
    expect(repo.findUserNames).not.toHaveBeenCalled()
  })

  it.each([
    ['legacy-file-id', ['legacy-file-id']],
    [['file-b', 'file-a'], ['file-b', 'file-a']],
    [null, []],
    [{ bad: true }, []],
  ])('normalizes a persisted FILE value at the read boundary', async (stored, expected) => {
    const repo = makeRepo({
      listProperties: vi.fn(async () => [
        { id: 'p-file', type: 'FILE', name: 'Файлы', position: 0, settings: null },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1', pageId: 'item-page', position: 0,
          createdAt: new Date(), createdById: 'u1', updatedAt: new Date(), updatedById: 'u1',
          page: { title: 'A', icon: null }, cells: [{ propertyId: 'p-file', value: stored }],
        },
      ]),
    })
    const result = await makeService(repo).listRows('u1', { pageId: 'db-page', limit: 100 })
    expect(result.rows[0]!.cells['p-file']).toEqual(expected)
  })
})

// ── C2: structure-edit guard ──────────────────────────────────────────────────

describe('DatabaseService.assertCanEditStructure (via structure ops)', () => {
  beforeEach(() => vi.clearAllMocks())

  // The actor created the source page → allowed to edit structure when unlocked.
  it('allows the source page creator when unlocked', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'u1',
      })),
    })
    await makeService(repo).createProperty('u1', { pageId: 'db-page', type: 'TEXT', name: 'X' })
    expect(repo.createProperty).toHaveBeenCalled()
  })

  it('allows an OWNER who is not the creator', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'OWNER'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
      // assertCanEdit (page-layer) must still pass — OWNER passes by role.
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'OWNER'),
    })
    await makeService(repo).createView('u1', { pageId: 'db-page', type: 'TABLE', title: 'V' })
    expect(repo.createView).toHaveBeenCalled()
  })

  it('blocks a plain EDITOR who is NOT the source page creator', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
      // page-layer assertCanEdit passes (EDITOR), so the FORBIDDEN comes from the structure guard.
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'),
    })
    await expect(
      makeService(repo).createProperty('u1', { pageId: 'db-page', type: 'TEXT', name: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(repo.createProperty).not.toHaveBeenCalled()
  })

  it('blocks the source page creator when structureLocked (only OWNER/ADMIN)', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: true, pageCreatedById: 'u1',
      })),
    })
    await expect(
      makeService(repo).createProperty('u1', { pageId: 'db-page', type: 'TEXT', name: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('allows an ADMIN even when structureLocked', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'ADMIN'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: true, pageCreatedById: 'other',
      })),
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'ADMIN'),
      // 2 views so deleteView clears the "single view" guard and reaches the delete.
      listViews: vi.fn(async () => [
        { id: 'view1', type: 'TABLE', title: 'A', position: 0, settings: null },
        { id: 'view2', type: 'TABLE', title: 'B', position: 1024, settings: null },
      ]),
      findViewById: vi.fn(async () => ({ id: 'view1', sourceId: 'src1' })),
    })
    await makeService(repo).deleteView('u1', { pageId: 'db-page', id: 'view1' })
    expect(repo.deleteView).toHaveBeenCalled()
  })

  it('gates updateView / deleteProperty / reorderProperties / duplicateView for a non-creator EDITOR', async () => {
    const base = {
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'),
    }
    await expect(
      makeService(makeRepo(base)).updateView('u1', { pageId: 'db-page', id: 'view1', title: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      makeService(makeRepo(base)).deleteProperty('u1', { pageId: 'db-page', id: 'prop1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      makeService(makeRepo(base)).reorderProperties('u1', { pageId: 'db-page', orderedIds: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      makeService(makeRepo(base)).duplicateView('u1', { pageId: 'db-page', viewId: 'view1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

// ── C2: access-rule ops ───────────────────────────────────────────────────────

describe('DatabaseService.createAccessRule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a rule for a PERSON property', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop-person', sourceId: 'src1', type: 'PERSON', settings: null })),
    })
    const rule = await makeService(repo).createAccessRule('u1', {
      pageId: 'db-page', propertyId: 'prop-person', accessLevel: 'CAN_VIEW',
    })
    expect(repo.createAccessRule).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src1', propertyId: 'prop-person', accessLevel: 'CAN_VIEW' }),
    )
    expect(rule).toEqual({ id: 'rule1', propertyId: 'prop-person', accessLevel: 'CAN_VIEW', enabled: true })
  })

  it('creates a rule for a CREATED_BY property', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop-cb', sourceId: 'src1', type: 'CREATED_BY', settings: null })),
    })
    await makeService(repo).createAccessRule('u1', {
      pageId: 'db-page', propertyId: 'prop-cb', accessLevel: 'CAN_EDIT_CONTENT',
    })
    expect(repo.createAccessRule).toHaveBeenCalled()
  })

  it('rejects a non-PERSON / non-CREATED_BY property (e.g. TEXT)', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop-text', sourceId: 'src1', type: 'TEXT', settings: null })),
    })
    await expect(
      makeService(repo).createAccessRule('u1', {
        pageId: 'db-page', propertyId: 'prop-text', accessLevel: 'CAN_VIEW',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(repo.createAccessRule).not.toHaveBeenCalled()
  })

  it('rejects a property that belongs to another source', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop-person', sourceId: 'other-src', type: 'PERSON', settings: null })),
    })
    await expect(
      makeService(repo).createAccessRule('u1', {
        pageId: 'db-page', propertyId: 'prop-person', accessLevel: 'CAN_VIEW',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('is FORBIDDEN for a non-creator EDITOR (managing rules is a structure op)', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop-person', sourceId: 'src1', type: 'PERSON', settings: null })),
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'),
    })
    await expect(
      makeService(repo).createAccessRule('u1', {
        pageId: 'db-page', propertyId: 'prop-person', accessLevel: 'CAN_VIEW',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('DatabaseService.listAccessRules / updateAccessRule / deleteAccessRule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the source rules', async () => {
    const repo = makeRepo({
      listAccessRules: vi.fn(async () => [
        { id: 'r1', propertyId: 'p1', accessLevel: 'CAN_VIEW', enabled: true },
      ]),
    })
    const rules = await makeService(repo).listAccessRules('u1', { pageId: 'db-page' })
    expect(rules).toEqual([{ id: 'r1', propertyId: 'p1', accessLevel: 'CAN_VIEW', enabled: true }])
    expect(repo.listAccessRules).toHaveBeenCalledWith('src1')
  })

  it('updates a rule scoped to the source', async () => {
    const repo = makeRepo()
    await makeService(repo).updateAccessRule('u1', { pageId: 'db-page', ruleId: 'rule1', enabled: false })
    expect(repo.updateAccessRule).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rule1', enabled: false }),
    )
  })

  it('rejects updating a rule that belongs to another source', async () => {
    const repo = makeRepo({
      findAccessRuleById: vi.fn(async () => ({ id: 'rule1', sourceId: 'other-src' })),
    })
    await expect(
      makeService(repo).updateAccessRule('u1', { pageId: 'db-page', ruleId: 'rule1', enabled: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(repo.updateAccessRule).not.toHaveBeenCalled()
  })

  it('deletes a rule scoped to the source', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).deleteAccessRule('u1', { pageId: 'db-page', ruleId: 'rule1' })
    expect(repo.deleteAccessRule).toHaveBeenCalledWith('rule1')
    expect(result).toEqual({ ok: true })
  })
})

describe('DatabaseService.setStructureLocked', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lets an OWNER lock the structure', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'OWNER'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
    })
    const result = await makeService(repo).setStructureLocked('u1', { pageId: 'db-page', locked: true })
    expect(repo.setStructureLocked).toHaveBeenCalledWith('src1', true)
    expect(result).toEqual({ ok: true })
  })

  it('is FORBIDDEN for the source page creator who is only an EDITOR (OWNER/ADMIN only)', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'u1',
      })),
    })
    await expect(
      makeService(repo).setStructureLocked('u1', { pageId: 'db-page', locked: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(repo.setStructureLocked).not.toHaveBeenCalled()
  })
})

describe('DatabaseService.getMyAccess', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports full caps for an OWNER', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'OWNER'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
    })
    const my = await makeService(repo).getMyAccess('u1', 'db-page')
    expect(my).toEqual({ canEditContent: true, canEditStructure: true, structureLocked: false })
  })

  it('reports content-edit but NOT structure-edit for a non-creator EDITOR', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
    })
    const my = await makeService(repo).getMyAccess('u1', 'db-page')
    expect(my).toEqual({ canEditContent: true, canEditStructure: false, structureLocked: false })
  })

  it('reports structureLocked + no structure-edit for an EDITOR when locked', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: true, pageCreatedById: 'u1',
      })),
    })
    const my = await makeService(repo).getMyAccess('u1', 'db-page')
    expect(my).toEqual({ canEditContent: true, canEditStructure: false, structureLocked: true })
  })

  it('reports no content-edit for a VIEWER', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'VIEWER'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
    })
    const my = await makeService(repo).getMyAccess('u1', 'db-page')
    expect(my).toEqual({ canEditContent: false, canEditStructure: false, structureLocked: false })
  })

  it('is surfaced in getByPage.myAccess', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      findSourceWithLockByPageId: vi.fn(async () => ({
        id: 'src1', workspaceId: 'w1', pageId: 'db-page', structureLocked: false, pageCreatedById: 'other',
      })),
    })
    const vm = await makeService(repo).getByPage('u1', 'db-page')
    expect(vm.myAccess).toEqual({ canEditContent: true, canEditStructure: false, structureLocked: false })
  })
})

// ── C3: row-access enforcement in reads + mutations ──────────────────────────

/** A full RowWithPage including row metadata (createdById) + cells, for access tests. */
function makeAccessRow(
  id: string,
  opts: { createdById?: string | null; cells?: Record<string, unknown>; position?: number } = {},
) {
  return {
    id,
    pageId: `page-${id}`,
    position: opts.position ?? 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    createdById: opts.createdById ?? null,
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    updatedById: opts.createdById ?? null,
    page: { title: `Строка ${id}`, icon: null },
    cells: Object.entries(opts.cells ?? {}).map(([propertyId, value]) => ({ propertyId, value })),
  }
}

const PERSON_PROP = { id: 'p-person', type: 'PERSON', name: 'Исполнитель', position: 0, settings: null }
const PERSON_RULE = { propertyId: 'p-person', propertyType: 'PERSON', accessLevel: 'CAN_VIEW', enabled: true }

describe('DatabaseService.listRows — row access', () => {
  beforeEach(() => vi.clearAllMocks())

  it('no rules → all rows returned for a plain VIEWER (behavior unchanged)', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'VIEWER'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => []),
      listProperties: vi.fn(async () => [PERSON_PROP]),
      findRowsPaged: vi.fn(async () => [
        makeAccessRow('r1', { createdById: 'other', cells: { 'p-person': 'someone' } }),
        makeAccessRow('r2', { createdById: 'other', cells: {} }),
      ]),
    })
    const result = await makeService(repo).listRows('viewer', { pageId: 'db-page', limit: 100 })
    expect(result.rows.map((r) => r.rowId)).toEqual(['r1', 'r2'])
  })

  it('CAN_VIEW PERSON rule → a restricted VIEWER sees only rows assigned to them', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'VIEWER'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => [PERSON_RULE]),
      listProperties: vi.fn(async () => [PERSON_PROP]),
      // The DB pre-filter would already narrow, but the mock returns both rows so
      // we assert the AUTHORITATIVE post-filter drops the unassigned one.
      findRowsPaged: vi.fn(async () => [
        makeAccessRow('mine', { createdById: 'other', cells: { 'p-person': 'viewer' } }),
        makeAccessRow('theirs', { createdById: 'other', cells: { 'p-person': 'someone-else' } }),
      ]),
    })
    const result = await makeService(repo).listRows('viewer', { pageId: 'db-page', limit: 100 })
    expect(result.rows.map((r) => r.rowId)).toEqual(['mine'])
  })

  it('CAN_VIEW PERSON rule → an OWNER still sees every row (broadest-access-wins)', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'OWNER'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => [PERSON_RULE]),
      listProperties: vi.fn(async () => [PERSON_PROP]),
      findRowsPaged: vi.fn(async () => [
        makeAccessRow('a', { createdById: 'other', cells: { 'p-person': 'someone' } }),
        makeAccessRow('b', { createdById: 'other', cells: {} }),
      ]),
    })
    const result = await makeService(repo).listRows('owner', { pageId: 'db-page', limit: 100 })
    expect(result.rows.map((r) => r.rowId)).toEqual(['a', 'b'])
  })

  it('passes a row-access where to the repo when restricted', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'VIEWER'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => [PERSON_RULE]),
      listProperties: vi.fn(async () => [PERSON_PROP]),
      findRowsPaged: vi.fn(async () => []),
    })
    await makeService(repo).listRows('viewer', { pageId: 'db-page', limit: 100 })
    const arg = (repo.findRowsPaged as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    // The access OR predicate is merged into the where (AND with the planner where).
    expect(JSON.stringify(arg.where)).toContain('p-person')
  })
})

describe('DatabaseService.updateCellValue — row access', () => {
  beforeEach(() => vi.clearAllMocks())

  it('FORBIDDEN when the actor only has CAN_VIEW on the row (PERSON rule, not assigned)', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'TEXT', settings: null })),
      findWorkspaceRole: vi.fn(async () => 'VIEWER'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => [PERSON_RULE]),
      // The row is assigned to someone else → resolver returns null (no view, no edit).
      findRowForAccess: vi.fn(async () => ({
        id: 'row1', sourceId: 'src1', rowCreatedById: 'other',
        cellsByProperty: new Map([['p-person', 'someone-else']]),
      })),
    })
    await expect(
      makeService(repo).updateCellValue('viewer', {
        pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'x',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(repo.upsertCellValue).not.toHaveBeenCalled()
  })

  it('allows the assigned user to edit when the rule grants CAN_EDIT_CONTENT', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'TEXT', settings: null })),
      findWorkspaceRole: vi.fn(async () => 'VIEWER'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => [
        { propertyId: 'p-person', propertyType: 'PERSON', accessLevel: 'CAN_EDIT_CONTENT', enabled: true },
      ]),
      findRowForAccess: vi.fn(async () => ({
        id: 'row1', sourceId: 'src1', rowCreatedById: 'other',
        cellsByProperty: new Map([['p-person', 'viewer']]),
      })),
    })
    await makeService(repo).updateCellValue('viewer', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'x',
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', 'x')
  })

  it('no rules → an EDITOR edits any row (unchanged)', async () => {
    const repo = makeRepo({
      findPropertyById: vi.fn(async () => ({ id: 'prop1', sourceId: 'src1', type: 'TEXT', settings: null })),
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'),
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => []),
      findRowForAccess: vi.fn(async () => ({
        id: 'row1', sourceId: 'src1', rowCreatedById: 'other', cellsByProperty: new Map(),
      })),
    })
    await makeService(repo).updateCellValue('editor', {
      pageId: 'db-page', rowId: 'row1', propertyId: 'prop1', value: 'x',
    })
    expect(repo.upsertCellValue).toHaveBeenCalledWith('row1', 'prop1', 'x')
  })
})

describe('DatabaseService.deleteRow — row access', () => {
  beforeEach(() => vi.clearAllMocks())

  it('FORBIDDEN when the actor only has CAN_VIEW on the row', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'VIEWER'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => [PERSON_RULE]),
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'), // page-layer passes; row-layer blocks
      findRowForAccess: vi.fn(async () => ({
        id: 'row1', sourceId: 'src1', rowCreatedById: 'other',
        cellsByProperty: new Map([['p-person', 'someone-else']]),
      })),
    })
    await expect(
      makeService(repo).deleteRow('viewer', { pageId: 'db-page', rowId: 'row1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(repo.softDeleteRow).not.toHaveBeenCalled()
  })
})

describe('DatabaseService.updateRowTitle — row access', () => {
  beforeEach(() => vi.clearAllMocks())

  it('FORBIDDEN when the actor only has CAN_VIEW on the row', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'VIEWER'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => [PERSON_RULE]),
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'),
      findRowForAccess: vi.fn(async () => ({
        id: 'row1', sourceId: 'src1', rowCreatedById: 'other',
        cellsByProperty: new Map([['p-person', 'someone-else']]),
      })),
    })
    await expect(
      makeService(repo).updateRowTitle('viewer', { pageId: 'db-page', rowId: 'row1', title: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(repo.updatePageTitle).not.toHaveBeenCalled()
  })
})

describe('DatabaseService.createRow — source-level edit gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a non-creator VIEWER cannot create a row (no source-level edit)', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'db-page', workspaceId: 'w1', createdById: 'other' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
    })
    await expect(
      makeService(repo).createRow('viewer', { pageId: 'db-page' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

// ── C4: relation/rollup traversal respects target-row access ─────────────────

describe('DatabaseService.listRows — relation/rollup target access', () => {
  beforeEach(() => vi.clearAllMocks())

  // A relation property whose target source ('src-t') carries a CAN_VIEW PERSON
  // rule. The restricted viewer is assigned to t1 (visible) but not t2 (hidden) →
  // the chip set must exclude t2 and a count rollup must count only t1.
  function restrictedTargetRepo() {
    return makeRepo({
      // The viewer of THIS database is a member with no rules on the host source.
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      // No rules on the HOST source (so the host rows aren't filtered).
      findEnabledAccessRules: vi.fn(async () => []),
      listProperties: vi.fn(async () => [
        { id: 'p-rel', type: 'RELATION', name: 'Связь', position: 0, settings: { relation: { targetSourceId: 'src-t' } } },
        { id: 'p-roll', type: 'ROLLUP', name: 'Кол', position: 1024, settings: { rollup: { relationPropertyId: 'p-rel', targetPropertyId: '__title__', aggregation: 'count_all' } } },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1', pageId: 'item-page', position: 0,
          createdAt: new Date(), createdById: 'viewer', updatedAt: new Date(), updatedById: 'viewer',
          page: { title: 'A', icon: null }, cells: [],
        },
      ]),
      findRelationLinksForProperties: vi.fn(async () => new Map([['p-rel', new Map([['row1', ['t1', 't2']]])]])),
      findRowsByIds: vi.fn(async () => [
        { id: 't1', pageId: 'pt1', title: 'T1', icon: null },
        { id: 't2', pageId: 'pt2', title: 'T2', icon: null },
      ]),
      findCellsForRows: vi.fn(async () => []),
      // The target rows belong to source 'src-t' in workspace 'w1'.
      findRowsAccessMetaByIds: vi.fn(async () => [
        { id: 't1', sourceId: 'src-t', workspaceId: 'w1', pageId: 'pt1', createdById: 'other', cellsByProperty: new Map([['tp-person', 'viewer']]) },
        { id: 't2', sourceId: 'src-t', workspaceId: 'w1', pageId: 'pt2', createdById: 'other', cellsByProperty: new Map([['tp-person', 'someone-else']]) },
      ]),
      // The target source has a CAN_VIEW PERSON rule on tp-person.
      findEnabledAccessRulesForSources: vi.fn(async () => new Map([
        ['src-t', [{ propertyId: 'tp-person', propertyType: 'PERSON', accessLevel: 'CAN_VIEW', enabled: true }]],
      ])),
    })
  }

  it('excludes a relation chip the viewer cannot access in the target source', async () => {
    const repo = restrictedTargetRepo()
    const result = await makeService(repo).listRows('viewer', { pageId: 'db-page', limit: 100 })
    const chips = result.rows[0]!.cells['p-rel'] as { rowId: string }[]
    expect(chips.map((c) => c.rowId)).toEqual(['t1'])
  })

  it('counts only accessible target rows in a rollup', async () => {
    const repo = restrictedTargetRepo()
    const result = await makeService(repo).listRows('viewer', { pageId: 'db-page', limit: 100 })
    // count_all over the link set, but t2 is inaccessible → 1, not 2.
    expect(result.rows[0]!.cells['p-roll']).toBe(1)
  })

  it('keeps all target chips when the target source has no rules (unchanged)', async () => {
    const repo = makeRepo({
      findWorkspaceRole: vi.fn(async () => 'EDITOR'),
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => []),
      listProperties: vi.fn(async () => [
        { id: 'p-rel', type: 'RELATION', name: 'Связь', position: 0, settings: { relation: { targetSourceId: 'src-t' } } },
      ]),
      findRowsPaged: vi.fn(async () => [
        {
          id: 'row1', pageId: 'item-page', position: 0,
          createdAt: new Date(), createdById: 'viewer', updatedAt: new Date(), updatedById: 'viewer',
          page: { title: 'A', icon: null }, cells: [],
        },
      ]),
      findRelationLinksForProperties: vi.fn(async () => new Map([['p-rel', new Map([['row1', ['t1', 't2']]])]])),
      findRowsByIds: vi.fn(async () => [
        { id: 't1', pageId: 'pt1', title: 'T1', icon: null },
        { id: 't2', pageId: 'pt2', title: 'T2', icon: null },
      ]),
      // No rules on the target source → no exclusion.
      findEnabledAccessRulesForSources: vi.fn(async () => new Map()),
    })
    const result = await makeService(repo).listRows('viewer', { pageId: 'db-page', limit: 100 })
    const chips = result.rows[0]!.cells['p-rel'] as { rowId: string }[]
    expect(chips.map((c) => c.rowId)).toEqual(['t1', 't2'])
  })
})
