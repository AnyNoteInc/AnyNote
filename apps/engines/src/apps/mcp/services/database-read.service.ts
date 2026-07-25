import { HttpException, Inject, Injectable } from '@nestjs/common'
import {
  DatabasePropertyType,
  isDomainError,
  type DatabaseGetByPageResult,
  type DatabaseRowView,
  type Domain,
} from '@repo/domain'

import { DOMAIN } from '../../../infra/domain/domain.providers.js'
import {
  DATABASE_FIELD_CATALOG,
  buildAgentDatabaseFields,
  type AgentDatabaseField,
} from '../database/database-query.schema.js'
import { compileDatabaseQuery } from '../database/database-filter-compiler.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'

export interface DatabaseReadContext {
  userId: string
  workspaceId: string
  pageId: string
}

export interface DatabaseQueryInput extends DatabaseReadContext {
  filter?: unknown
  sorts?: unknown
  cursor?: string
  limit?: number
}

export interface AgentDatabaseSchema {
  page: { id: string; title: string | null }
  sourceId: string
  fields: AgentDatabaseField[]
}

export interface AgentDatabaseQueryResult extends AgentDatabaseSchema {
  records: Array<{
    rowId: string
    pageId: string
    title: string | null
    values: Record<string, unknown>
  }>
  nextCursor: string | null
}

type LoadedDatabase = {
  resultSchema: AgentDatabaseSchema
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringProperty(value: Record<string, unknown>, key: string): string | undefined
function stringProperty(
  value: Record<string, unknown>,
  key: string,
  nullable: true,
): string | null | undefined
function stringProperty(
  value: Record<string, unknown>,
  key: string,
  nullable = false,
): string | null | undefined {
  const property = value[key]
  if (nullable && property === null) return null
  return typeof property === 'string' ? property : undefined
}

function optionId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.id === 'string') return value.id
  return null
}

function mapOption(field: AgentDatabaseField, value: unknown): { id: string; name: string } | null {
  const id = optionId(value)
  if (id === null) return null
  return field.options?.find((option) => option.id === id) ?? null
}

function mapOptionList(
  field: AgentDatabaseField,
  value: unknown,
): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const option = mapOption(field, item)
    return option === null ? [] : [option]
  })
}

function mapRelationList(value: unknown): Array<{
  rowId: string
  pageId: string
  title: string | null
  icon: string | null
}> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const rowId = stringProperty(item, 'rowId')
    const pageId = stringProperty(item, 'pageId')
    const title = stringProperty(item, 'title', true)
    const icon = stringProperty(item, 'icon', true)
    if (rowId === undefined || pageId === undefined || title === undefined || icon === undefined) {
      return []
    }
    return [{ rowId, pageId, title, icon }]
  })
}

function mapFileList(value: unknown): Array<{
  id: string
  name?: string
  mimeType?: string
  fileSize?: string
}> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.length === 0 ? [] : [{ id: item }]
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) return []
    const name = stringProperty(item, 'name')
    const mimeType = stringProperty(item, 'mimeType')
    const rawFileSize = item.fileSize
    const fileSize =
      typeof rawFileSize === 'string'
        ? rawFileSize
        : typeof rawFileSize === 'bigint'
          ? rawFileSize.toString()
          : undefined
    return [
      {
        id: item.id,
        ...(name === undefined ? {} : { name }),
        ...(mimeType === undefined ? {} : { mimeType }),
        ...(fileSize === undefined ? {} : { fileSize }),
      },
    ]
  })
}

function mapPersonList(
  type: AgentDatabaseField['type'],
  value: unknown,
): Array<{ id?: string; name?: string; image?: string | null }> {
  if (typeof value === 'string') {
    return type === DatabasePropertyType.PERSON ? [{ id: value }] : [{ name: value }]
  }
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return [{ id: item }]
    if (!isRecord(item)) return []
    const id = stringProperty(item, 'id')
    const name = stringProperty(item, 'name')
    const image = stringProperty(item, 'image', true)
    if (id === undefined && name === undefined) return []
    return [
      {
        ...(id === undefined ? {} : { id }),
        ...(name === undefined ? {} : { name }),
        ...(image === undefined ? {} : { image }),
      },
    ]
  })
}

function mapPageLinkList(
  value: unknown,
): Array<{ pageId: string; title?: string | null; icon?: string | null }> {
  const items = Array.isArray(value) ? value : [value]
  return items.flatMap((item) => {
    if (typeof item === 'string') return item.length === 0 ? [] : [{ pageId: item }]
    if (!isRecord(item)) return []
    const pageId =
      stringProperty(item, 'pageId') ?? (typeof item.id === 'string' ? item.id : undefined)
    if (pageId === undefined) return []
    const title = stringProperty(item, 'title', true)
    const icon = stringProperty(item, 'icon', true)
    return [
      {
        pageId,
        ...(title === undefined ? {} : { title }),
        ...(icon === undefined ? {} : { icon }),
      },
    ]
  })
}

function mapComputed(value: unknown): unknown {
  if (isRecord(value) && typeof value.__error === 'string') {
    return { __error: value.__error }
  }
  return value
}

function mapWireValue(field: AgentDatabaseField, value: unknown): unknown {
  if (value === null || value === undefined) return null

  switch (DATABASE_FIELD_CATALOG[field.type].wireMapper) {
    case 'string':
      return typeof value === 'string' ? value : null
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    case 'boolean':
      return typeof value === 'boolean' ? value : null
    case 'money':
      return typeof value === 'number' && Number.isInteger(value)
        ? { kopecks: value, rubles: value / 100, currency: 'RUB' as const }
        : null
    case 'date': {
      const date =
        value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
      return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null
    }
    case 'option':
      return mapOption(field, value)
    case 'option-list':
      return mapOptionList(field, value)
    case 'relation-list':
      return mapRelationList(value)
    case 'file-list':
      return mapFileList(value)
    case 'person-list':
      return mapPersonList(field.type, value)
    case 'page-link-list':
      return mapPageLinkList(value)
    case 'computed':
      return mapComputed(value)
  }
}

function mapDomainError(error: unknown, pageId: string): unknown {
  if (!isDomainError(error)) return error
  if (error.code === 'NOT_FOUND') return new PageNotFoundError(pageId)
  return new HttpException({ code: error.code, message: error.message }, error.httpStatus)
}

@Injectable()
export class DatabaseReadService {
  constructor(@Inject(DOMAIN) private readonly domain: Domain) {}

  async getSchema(input: DatabaseReadContext): Promise<AgentDatabaseSchema> {
    return (await this.loadContext(input)).resultSchema
  }

  async query(input: DatabaseQueryInput): Promise<AgentDatabaseQueryResult> {
    const loaded = await this.loadContext(input)
    const compiled = compileDatabaseQuery(loaded.resultSchema.fields, {
      filter: input.filter,
      sorts: input.sorts,
    })

    let page
    try {
      page = await this.domain.database.queryRows(input.userId, {
        pageId: input.pageId,
        filter: compiled.filter,
        sorts: compiled.sorts,
        cursor: input.cursor,
        limit: input.limit ?? 100,
      })
    } catch (error) {
      throw mapDomainError(error, input.pageId)
    }

    const propertyFields = loaded.resultSchema.fields.filter((field) => field.type !== 'TITLE')
    return {
      ...loaded.resultSchema,
      records: page.rows.map((databaseRow) => this.mapRow(propertyFields, databaseRow)),
      nextCursor: page.nextCursor,
    }
  }

  private async loadContext(input: DatabaseReadContext): Promise<LoadedDatabase> {
    let schema: DatabaseGetByPageResult
    try {
      schema = await this.domain.database.getByPage(input.userId, input.pageId)
    } catch (error) {
      throw mapDomainError(error, input.pageId)
    }

    if (schema.source.pageId !== input.pageId || schema.source.workspaceId !== input.workspaceId) {
      throw new PageNotFoundError(input.pageId)
    }

    return {
      resultSchema: {
        page: { id: schema.source.pageId, title: schema.source.title },
        sourceId: schema.source.id,
        fields: buildAgentDatabaseFields(schema),
      },
    }
  }

  private mapRow(
    fields: AgentDatabaseField[],
    databaseRow: DatabaseRowView,
  ): AgentDatabaseQueryResult['records'][number] {
    return {
      rowId: databaseRow.rowId,
      pageId: databaseRow.pageId,
      title: databaseRow.title,
      values: Object.fromEntries(
        fields.map((field) => [field.id, mapWireValue(field, databaseRow.cells[field.id])]),
      ),
    }
  }
}
