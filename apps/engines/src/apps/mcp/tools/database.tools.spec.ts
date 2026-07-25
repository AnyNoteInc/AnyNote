import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import { DbModule } from '../../../infra/db/db.module.js'
import { PRISMA } from '../../../infra/db/db.providers.js'
import { DomainModule } from '../../../infra/domain/domain.module.js'
import { DOMAIN } from '../../../infra/domain/domain.providers.js'
import { AuthModule } from '../../../auth/auth.module.js'
import {
  GetDatabaseSchemaInput,
  QueryDatabaseRecordsInput,
} from '../database/database-query.schema.js'
import { McpModule } from '../mcp.module.js'
import { DatabaseReadService } from '../services/database-read.service.js'
import { DatabaseTools } from './database.tools.js'

describe('DatabaseTools', () => {
  const workspaceId = '22222222-2222-4222-8222-222222222222'
  const pageId = '33333333-3333-4333-8333-333333333333'
  const otherPageId = '44444444-4444-4444-8444-444444444444'
  const userId = 'user-1'

  const memberFindUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const blockedFindUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findUnique: memberFindUnique },
    workspaceBlockedUser: { findUnique: blockedFindUnique },
  } as unknown as PrismaClient
  const getSchema = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const query = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const databaseRead = { getSchema, query } as unknown as DatabaseReadService
  const req = {
    headers: {},
    auth: { userId, source: 'internal' as const },
  } satisfies AuthedRequest

  let tools: DatabaseTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId })
    blockedFindUnique.mockResolvedValue(null)
    tools = new DatabaseTools(prisma, databaseRead)
  })

  it.each([
    [
      'getDatabaseSchema',
      () =>
        tools.getDatabaseSchema(
          { workspaceId, pageId },
          {} as never,
          { headers: {} } as AuthedRequest,
        ),
    ],
    [
      'queryDatabaseRecords',
      () =>
        tools.queryDatabaseRecords(
          { workspaceId, pageId, limit: 100 },
          {} as never,
          { headers: {} } as AuthedRequest,
        ),
    ],
  ] as const)(
    '%s rejects an unauthenticated request before reading data',
    async (_method, call) => {
      await expect(call()).rejects.toBeInstanceOf(UnauthorizedException)
      expect(memberFindUnique).not.toHaveBeenCalled()
      expect(getSchema).not.toHaveBeenCalled()
      expect(query).not.toHaveBeenCalled()
    },
  )

  it('getDatabaseSchema authenticates membership and passes the caller identity to the service', async () => {
    const schema = { page: { id: pageId, title: 'Budget' }, sourceId: 'source-1', fields: [] }
    getSchema.mockResolvedValue(schema)

    await expect(
      tools.getDatabaseSchema({ workspaceId, pageId }, {} as never, req),
    ).resolves.toEqual(schema)

    expect(memberFindUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { workspaceId: true },
    })
    expect(getSchema).toHaveBeenCalledWith({ userId, workspaceId, pageId })
    expect(memberFindUnique.mock.invocationCallOrder[0]).toBeLessThan(
      getSchema.mock.invocationCallOrder[0]!,
    )
  })

  it('queryDatabaseRecords forwards filter, sorts, cursor, and limit after membership', async () => {
    const filter = {
      conjunction: 'and',
      conditions: [{ fieldId: '__title__', operator: 'contains', value: 'July' }],
    }
    const sorts = [{ fieldId: '__title__', direction: 'asc' }]
    const result = {
      page: { id: pageId, title: 'Budget' },
      sourceId: 'source-1',
      fields: [],
      records: [],
      nextCursor: null,
    }
    query.mockResolvedValue(result)

    await expect(
      tools.queryDatabaseRecords(
        { workspaceId, pageId, filter, sorts, cursor: 'cursor-1', limit: 25 },
        {} as never,
        req,
      ),
    ).resolves.toEqual(result)

    expect(memberFindUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { workspaceId: true },
    })
    expect(query).toHaveBeenCalledWith({
      userId,
      workspaceId,
      pageId,
      filter,
      sorts,
      cursor: 'cursor-1',
      limit: 25,
    })
    expect(memberFindUnique.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[0]!,
    )
  })

  it.each([
    [
      'getDatabaseSchema',
      () =>
        tools.getDatabaseSchema({ workspaceId, pageId: otherPageId }, {} as never, {
          headers: {},
          auth: { userId, source: 'internal' as const, boundPageId: pageId },
        }),
      getSchema,
    ],
    [
      'queryDatabaseRecords',
      () =>
        tools.queryDatabaseRecords({ workspaceId, pageId: otherPageId, limit: 100 }, {} as never, {
          headers: {},
          auth: { userId, source: 'internal' as const, boundPageId: pageId },
        }),
      query,
    ],
  ] as const)(
    '%s rejects a mismatched page binding after membership and before the service call',
    async (_method, call, serviceMethod) => {
      await expect(call()).rejects.toThrow(
        `Этот чат привязан к другой странице — доступна только страница ${pageId}`,
      )

      expect(memberFindUnique).toHaveBeenCalled()
      expect(serviceMethod).not.toHaveBeenCalled()
    },
  )

  it('applies the query limit default at the MCP input boundary', () => {
    expect(QueryDatabaseRecordsInput.parse({ workspaceId, pageId })).toEqual({
      workspaceId,
      pageId,
      limit: 100,
    })
    expect(GetDatabaseSchemaInput.parse({ workspaceId, pageId })).toEqual({ workspaceId, pageId })
  })

  it.each([
    ['getDatabaseSchema', 'getDatabaseSchema'],
    ['queryDatabaseRecords', 'queryDatabaseRecords'],
  ] as const)('%s is exposed as a read-only MCP tool', (method, expectedName) => {
    const metadata = Reflect.getMetadata('mcp:tool', DatabaseTools.prototype[method]) as {
      name: string
      description: string
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
    }

    expect(metadata.name).toBe(expectedName)
    expect(metadata.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  })

  it('teaches schema-first querying, recursive filters, unbounded dates, pagination, and MONEY units', () => {
    const schemaMetadata = Reflect.getMetadata(
      'mcp:tool',
      DatabaseTools.prototype.getDatabaseSchema,
    ) as { description: string }
    const queryMetadata = Reflect.getMetadata(
      'mcp:tool',
      DatabaseTools.prototype.queryDatabaseRecords,
    ) as { description: string }

    expect(schemaMetadata.description).toContain('сначала')
    expect(schemaMetadata.description).toContain('queryDatabaseRecords')
    expect(queryMetadata.description).toContain('getDatabaseSchema')
    expect(queryMetadata.description).toMatch(
      /condition.*conjunction.*conditions.*not|condition.*not.*conjunction.*conditions/,
    )
    expect(queryMetadata.description).toMatch(/дат.*опуст/)
    expect(queryMetadata.description).toContain('nextCursor')
    expect(queryMetadata.description).toContain('MONEY')
    expect(queryMetadata.description).toContain('копейках')
    expect(queryMetadata.description).toContain('рублях')
  })
})

describe('McpModule database tool registration', () => {
  it('compiles with DatabaseReadService and DatabaseTools available', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule, DomainModule, AuthModule, McpModule],
    })
      .overrideProvider(PRISMA)
      .useValue({})
      .overrideProvider(DOMAIN)
      .useValue({} as Domain)
      .compile()

    expect(moduleRef.get(DatabaseReadService)).toBeInstanceOf(DatabaseReadService)
    expect(moduleRef.get(DatabaseTools)).toBeInstanceOf(DatabaseTools)

    await moduleRef.close()
  })
})
