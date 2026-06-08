import { PageType, Prisma, enqueueOutboxEvent } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'

// ── Internal I/O types ────────────────────────────────────────────────────────

export interface AccessiblePage {
  id: string
  workspaceId: string
  createdById: string | null
}

export interface SourceRow {
  id: string
  workspaceId: string
  pageId: string
  title: string | null
}

export interface ViewRow {
  id: string
  type: import('@repo/db').DatabaseViewType
  title: string
  position: number
  settings: unknown
}

export interface PropertyRow {
  id: string
  type: import('@repo/db').DatabasePropertyType
  name: string
  position: number
  settings: unknown
}

export interface RowWithPage {
  id: string
  pageId: string
  position: number
  page: { title: string | null; icon: string | null }
  cells: { propertyId: string; value: unknown }[]
}

/**
 * The pure query-planner emits `{ value: { equals: null } }` as an intermediate
 * JSON-null sentinel (it cannot import Prisma's `DbNull` runtime value under the
 * domain-services-no-db-value rule). At execution time we swap that literal
 * `null` for `Prisma.DbNull` so Postgres compares against SQL NULL. Recursively
 * rewrites the where tree; safe to call on any planner output.
 */
function translateNullSentinels(
  node: Prisma.DatabaseRowWhereInput,
): Prisma.DatabaseRowWhereInput {
  return deepTranslate(node) as Prisma.DatabaseRowWhereInput
}

function deepTranslate(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepTranslate)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (
        key === 'value' &&
        val &&
        typeof val === 'object' &&
        'equals' in (val as Record<string, unknown>) &&
        (val as Record<string, unknown>).equals === null
      ) {
        out[key] = { ...(val as Record<string, unknown>), equals: Prisma.DbNull }
      } else {
        out[key] = deepTranslate(val)
      }
    }
    return out
  }
  return node
}

export class DatabaseRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  // ── Access queries ──────────────────────────────────────────────────────────

  async findAccessiblePage(userId: string, pageId: string): Promise<AccessiblePage | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: pageId, workspace: { members: { some: { userId } } } },
      select: { id: true, workspaceId: true, createdById: true },
    })
    if (!row) return null
    return { id: row.id, workspaceId: row.workspaceId, createdById: row.createdById }
  }

  async findMembershipRole(userId: string, workspaceId: string): Promise<string | null> {
    const member = await this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
    return member?.role ?? null
  }

  // ── Source ────────────────────────────────────────────────────────────────

  async createSource(data: {
    workspaceId: string
    pageId: string
    title: string | null
  }): Promise<SourceRow> {
    const row = await this.uow.client().databaseSource.create({
      data: { workspaceId: data.workspaceId, pageId: data.pageId, title: data.title },
      select: { id: true, workspaceId: true, pageId: true, title: true },
    })
    return row
  }

  async findSourceByPageId(pageId: string): Promise<{
    source: SourceRow
    views: ViewRow[]
    properties: PropertyRow[]
    rows: RowWithPage[]
  } | null> {
    const row = await this.uow.client().databaseSource.findUnique({
      where: { pageId },
      select: {
        id: true,
        workspaceId: true,
        pageId: true,
        title: true,
        views: {
          select: { id: true, type: true, title: true, position: true, settings: true },
          orderBy: { position: 'asc' },
        },
        properties: {
          select: { id: true, type: true, name: true, position: true, settings: true },
          orderBy: { position: 'asc' },
        },
        rows: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            pageId: true,
            position: true,
            page: { select: { title: true, icon: true } },
            cells: { select: { propertyId: true, value: true } },
          },
        },
      },
    })
    if (!row) return null
    return {
      source: { id: row.id, workspaceId: row.workspaceId, pageId: row.pageId, title: row.title },
      views: row.views as ViewRow[],
      properties: row.properties as PropertyRow[],
      rows: row.rows as RowWithPage[],
    }
  }

  /** Schema-only source load (source + views + properties, NO rows) — the
   *  Phase-4A fetch split; rows come from `findRowsPaged`/`findRowsForGrouping`. */
  async findSourceSchemaByPageId(pageId: string): Promise<{
    source: SourceRow
    views: ViewRow[]
    properties: PropertyRow[]
  } | null> {
    const row = await this.uow.client().databaseSource.findUnique({
      where: { pageId },
      select: {
        id: true,
        workspaceId: true,
        pageId: true,
        title: true,
        views: {
          select: { id: true, type: true, title: true, position: true, settings: true },
          orderBy: { position: 'asc' },
        },
        properties: {
          select: { id: true, type: true, name: true, position: true, settings: true },
          orderBy: { position: 'asc' },
        },
      },
    })
    if (!row) return null
    return {
      source: { id: row.id, workspaceId: row.workspaceId, pageId: row.pageId, title: row.title },
      views: row.views as ViewRow[],
      properties: row.properties as PropertyRow[],
    }
  }

  async findSourceMetaByPageId(
    pageId: string,
  ): Promise<{ id: string; workspaceId: string; pageId: string } | null> {
    return this.uow.client().databaseSource.findUnique({
      where: { pageId },
      select: { id: true, workspaceId: true, pageId: true },
    })
  }

  /** Resolve a source's owning DATABASE page (used by the embedded-database
   *  node, which references a source by id and must resolve its pageId). */
  async findSourceMetaById(
    sourceId: string,
  ): Promise<{ id: string; workspaceId: string; pageId: string } | null> {
    return this.uow.client().databaseSource.findUnique({
      where: { id: sourceId },
      select: { id: true, workspaceId: true, pageId: true },
    })
  }

  // ── Views ───────────────────────────────────────────────────────────────────

  async listViews(sourceId: string): Promise<ViewRow[]> {
    return this.uow.client().databaseView.findMany({
      where: { sourceId },
      orderBy: { position: 'asc' },
      select: { id: true, type: true, title: true, position: true, settings: true },
    }) as Promise<ViewRow[]>
  }

  async createView(data: {
    sourceId: string
    type: import('@repo/db').DatabaseViewType
    title: string
    position: number
    settings?: Prisma.InputJsonValue
  }): Promise<ViewRow> {
    return this.uow.client().databaseView.create({
      data: {
        sourceId: data.sourceId,
        type: data.type,
        title: data.title,
        position: data.position,
        ...(data.settings === undefined ? {} : { settings: data.settings }),
      },
      select: { id: true, type: true, title: true, position: true, settings: true },
    }) as Promise<ViewRow>
  }

  async updateView(
    id: string,
    data: { title?: string; settings?: Prisma.InputJsonValue },
  ): Promise<ViewRow> {
    return this.uow.client().databaseView.update({
      where: { id },
      data,
      select: { id: true, type: true, title: true, position: true, settings: true },
    }) as Promise<ViewRow>
  }

  async deleteView(id: string): Promise<void> {
    await this.uow.client().databaseView.delete({ where: { id } })
  }

  async findViewById(
    id: string,
  ): Promise<{ id: string; sourceId: string } | null> {
    return this.uow.client().databaseView.findUnique({
      where: { id },
      select: { id: true, sourceId: true },
    })
  }

  // ── Properties ───────────────────────────────────────────────────────────────

  async listProperties(sourceId: string): Promise<PropertyRow[]> {
    return this.uow.client().databaseProperty.findMany({
      where: { sourceId },
      orderBy: { position: 'asc' },
      select: { id: true, type: true, name: true, position: true, settings: true },
    }) as Promise<PropertyRow[]>
  }

  async createProperty(data: {
    sourceId: string
    type: import('@repo/db').DatabasePropertyType
    name: string
    position: number
    settings: Prisma.InputJsonValue | undefined
  }): Promise<PropertyRow> {
    return this.uow.client().databaseProperty.create({
      data: {
        sourceId: data.sourceId,
        type: data.type,
        name: data.name,
        position: data.position,
        ...(data.settings === undefined ? {} : { settings: data.settings }),
      },
      select: { id: true, type: true, name: true, position: true, settings: true },
    }) as Promise<PropertyRow>
  }

  async updateProperty(
    id: string,
    data: {
      name?: string
      type?: import('@repo/db').DatabasePropertyType
      settings?: Prisma.InputJsonValue
    },
  ): Promise<PropertyRow> {
    return this.uow.client().databaseProperty.update({
      where: { id },
      data,
      select: { id: true, type: true, name: true, position: true, settings: true },
    }) as Promise<PropertyRow>
  }

  async deleteProperty(id: string): Promise<void> {
    // Cells cascade via the DatabaseCellValue → DatabaseProperty FK (onDelete: Cascade).
    await this.uow.client().databaseProperty.delete({ where: { id } })
  }

  async findPropertyById(
    id: string,
  ): Promise<{ id: string; sourceId: string; type: import('@repo/db').DatabasePropertyType; settings: unknown } | null> {
    return this.uow.client().databaseProperty.findUnique({
      where: { id },
      select: { id: true, sourceId: true, type: true, settings: true },
    })
  }

  async reorderProperties(ordered: { id: string; position: number }[]): Promise<void> {
    await this.uow.transaction(async () => {
      for (const { id, position } of ordered) {
        await this.uow.client().databaseProperty.update({ where: { id }, data: { position } })
      }
    })
  }

  async maxPropertyPosition(sourceId: string): Promise<number> {
    const agg = await this.uow.client().databaseProperty.aggregate({
      where: { sourceId },
      _max: { position: true },
    })
    return agg._max.position ?? 0
  }

  // ── Rows ─────────────────────────────────────────────────────────────────────

  /** Insert the DatabaseRow bridge only — the item Page is created by the service. */
  async createRow(data: {
    sourceId: string
    pageId: string
    position: number
    createdById: string
  }): Promise<{ id: string; pageId: string; position: number }> {
    return this.uow.client().databaseRow.create({
      data: {
        sourceId: data.sourceId,
        pageId: data.pageId,
        position: data.position,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
      select: { id: true, pageId: true, position: true },
    })
  }

  async findRowsBySource(sourceId: string, query?: string): Promise<RowWithPage[]> {
    const trimmed = query?.trim()
    const where: Prisma.DatabaseRowWhereInput = { sourceId, deletedAt: null }
    if (trimmed) {
      where.OR = [
        { page: { title: { contains: trimmed, mode: 'insensitive' } } },
        {
          cells: {
            some: {
              value: { string_contains: trimmed },
            },
          },
        },
      ]
    }
    return this.uow.client().databaseRow.findMany({
      where,
      orderBy: { position: 'asc' },
      select: {
        id: true,
        pageId: true,
        position: true,
        page: { select: { title: true, icon: true } },
        cells: { select: { propertyId: true, value: true } },
      },
    }) as Promise<RowWithPage[]>
  }

  /**
   * Paginated, view-aware row fetch. Merges the planner's `where` (which may
   * carry `{ equals: null }` JSON-null sentinels) with the source/soft-delete
   * base where, applies the planner `orderBy` (a total order is guaranteed by an
   * appended `id` tiebreak), and fetches `take + 1` rows so the service can
   * detect a next page. `cursor` is the last returned row id (keyset via Prisma
   * `cursor` + `skip: 1`).
   */
  async findRowsPaged(args: {
    sourceId: string
    where: Prisma.DatabaseRowWhereInput
    orderBy: Prisma.DatabaseRowOrderByWithRelationInput[]
    take: number
    cursor?: string
  }): Promise<RowWithPage[]> {
    const where: Prisma.DatabaseRowWhereInput = {
      AND: [
        { sourceId: args.sourceId, deletedAt: null },
        translateNullSentinels(args.where),
      ],
    }
    // Guarantee a total order for stable keyset pagination.
    const orderBy: Prisma.DatabaseRowOrderByWithRelationInput[] = [
      ...args.orderBy,
      { id: 'asc' },
    ]
    return this.uow.client().databaseRow.findMany({
      where,
      orderBy,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        pageId: true,
        position: true,
        page: { select: { title: true, icon: true } },
        cells: { select: { propertyId: true, value: true } },
      },
    }) as Promise<RowWithPage[]>
  }

  /**
   * Fetch ALL matching rows + cells for grouping (BOARD). No pagination — a
   * focused board view is bounded in practice (documented MVP limit). Merges the
   * planner `where` (filters only; grouping/sorting handled in the service).
   */
  async findRowsForGrouping(args: {
    sourceId: string
    where: Prisma.DatabaseRowWhereInput
  }): Promise<RowWithPage[]> {
    const where: Prisma.DatabaseRowWhereInput = {
      AND: [
        { sourceId: args.sourceId, deletedAt: null },
        translateNullSentinels(args.where),
      ],
    }
    return this.uow.client().databaseRow.findMany({
      where,
      orderBy: { position: 'asc' },
      select: {
        id: true,
        pageId: true,
        position: true,
        page: { select: { title: true, icon: true } },
        cells: { select: { propertyId: true, value: true } },
      },
    }) as Promise<RowWithPage[]>
  }

  async findRowById(rowId: string): Promise<{
    id: string
    sourceId: string
    pageId: string
    deletedAt: Date | null
  } | null> {
    return this.uow.client().databaseRow.findUnique({
      where: { id: rowId },
      select: { id: true, sourceId: true, pageId: true, deletedAt: true },
    })
  }

  async softDeleteRow(rowId: string, updatedById: string): Promise<void> {
    await this.uow.client().databaseRow.update({
      where: { id: rowId },
      data: { deletedAt: new Date(), updatedById },
    })
  }

  async restoreRow(rowId: string, updatedById: string): Promise<void> {
    await this.uow.client().databaseRow.update({
      where: { id: rowId },
      data: { deletedAt: null, updatedById },
    })
  }

  async reorderRows(ordered: { id: string; position: number }[]): Promise<void> {
    await this.uow.transaction(async () => {
      for (const { id, position } of ordered) {
        await this.uow.client().databaseRow.update({ where: { id }, data: { position } })
      }
    })
  }

  async maxRowPosition(sourceId: string): Promise<number> {
    const agg = await this.uow.client().databaseRow.aggregate({
      where: { sourceId, deletedAt: null },
      _max: { position: true },
    })
    return agg._max.position ?? 0
  }

  // ── Item-page bridge (title/icon live on the real Page) ──────────────────────

  async updatePageTitle(pageId: string, title: string | null, updatedById: string): Promise<void> {
    await this.uow.client().page.update({
      where: { id: pageId },
      data: { title, updatedById },
    })
  }

  async updatePageIcon(pageId: string, icon: string | null, updatedById: string): Promise<void> {
    await this.uow.client().page.update({
      where: { id: pageId },
      data: { icon, updatedById },
    })
  }

  async softDeleteItemPage(
    pageId: string,
    updatedById: string,
    workspaceId: string,
  ): Promise<void> {
    await this.uow.client().page.update({
      where: { id: pageId },
      data: { deletedAt: new Date(), prevPageId: null, updatedById },
    })
    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.deleted',
      aggregateType: 'page',
      aggregateId: pageId,
      workspaceId,
    })
  }

  async restoreItemPage(
    pageId: string,
    updatedById: string,
    workspaceId: string,
  ): Promise<void> {
    await this.uow.client().page.update({
      where: { id: pageId },
      data: { deletedAt: null, updatedById },
    })
    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: pageId,
      workspaceId,
    })
  }

  // ── Cells ────────────────────────────────────────────────────────────────────

  async upsertCellValue(
    rowId: string,
    propertyId: string,
    value: string | number | boolean | string[] | null,
  ): Promise<void> {
    // `null` clears the cell → store SQL NULL via Prisma.DbNull.
    const stored: Prisma.InputJsonValue | typeof Prisma.DbNull =
      value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue)
    await this.uow.client().databaseCellValue.upsert({
      where: { rowId_propertyId: { rowId, propertyId } },
      create: { rowId, propertyId, value: stored },
      update: { value: stored },
    })
  }

  // ── Item page creation (focused, no provisioning callback) ───────────────────
  // Delegated to PageRepository.createItemPageTx; this constant documents the type.
  static readonly ITEM_PAGE_TYPE = PageType.TEXT
}
