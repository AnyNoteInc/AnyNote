import { PageType, enqueueOutboxEvent } from '@repo/db'
import type { Prisma } from '@repo/db'

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

  async findSourceMetaByPageId(
    pageId: string,
  ): Promise<{ id: string; workspaceId: string; pageId: string } | null> {
    return this.uow.client().databaseSource.findUnique({
      where: { pageId },
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
  }): Promise<ViewRow> {
    return this.uow.client().databaseView.create({
      data,
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
    for (const { id, position } of ordered) {
      await this.uow.client().databaseProperty.update({ where: { id }, data: { position } })
    }
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
    for (const { id, position } of ordered) {
      await this.uow.client().databaseRow.update({ where: { id }, data: { position } })
    }
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
    value: Prisma.InputJsonValue | typeof Prisma.JsonNull,
  ): Promise<void> {
    await this.uow.client().databaseCellValue.upsert({
      where: { rowId_propertyId: { rowId, propertyId } },
      create: { rowId, propertyId, value },
      update: { value },
    })
  }

  // ── Item page creation (focused, no provisioning callback) ───────────────────
  // Delegated to PageRepository.createItemPageTx; this constant documents the type.
  static readonly ITEM_PAGE_TYPE = PageType.TEXT
}
