import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { assertMember } from '../../api/auth/membership.js'
import { assertPageBindingAllows } from '../../api/auth/page-binding.js'
import {
  GetDatabaseSchemaInput,
  QueryDatabaseRecordsInput,
} from '../database/database-query.schema.js'
import { DatabaseReadService } from '../services/database-read.service.js'

type GetDatabaseSchemaArgs = z.infer<typeof GetDatabaseSchemaInput>
type QueryDatabaseRecordsArgs = z.infer<typeof QueryDatabaseRecordsInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class DatabaseTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly databaseRead: DatabaseReadService,
  ) {}

  @Tool({
    name: 'getDatabaseSchema',
    description:
      'Возвращает схему базы данных: поля, их типы, допустимые операторы фильтрации ' +
      'и варианты значений. Всегда вызывай этот tool сначала, перед ' +
      'queryDatabaseRecords, чтобы использовать актуальные fieldId и операторы. ' +
      'MONEY описывает денежные значения одновременно в копейках и рублях. ' +
      'Параметры: workspaceId, pageId.',
    parameters: GetDatabaseSchemaInput,
    annotations: { readOnlyHint: true, destructiveHint: false },
  })
  async getDatabaseSchema(args: GetDatabaseSchemaArgs, _context: Context, req: AuthedRequest) {
    return this.doGetDatabaseSchema(requireAuth(req), args)
  }

  async doGetDatabaseSchema(auth: AuthContext, args: GetDatabaseSchemaArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertPageBindingAllows(auth, args.pageId)
    return this.databaseRead.getSchema({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
    })
  }

  @Tool({
    name: 'queryDatabaseRecords',
    description:
      'Читает записи базы данных. Сначала вызови getDatabaseSchema и используй ' +
      'возвращённые fieldId, типы и filterOperators. filter имеет рекурсивную форму: ' +
      'condition или { conjunction, conditions } или { not }. Фильтр по дате можно ' +
      'опустить, чтобы прочитать все строки источника. Если nextCursor не null, ' +
      'продолжай чтение следующим вызовом, передав nextCursor как cursor. MONEY ' +
      'возвращается одновременно в копейках и рублях. Параметры: workspaceId, pageId, ' +
      'filter?, sorts?, cursor?, limit? (по умолчанию 100, максимум 200).',
    parameters: QueryDatabaseRecordsInput,
    annotations: { readOnlyHint: true, destructiveHint: false },
  })
  async queryDatabaseRecords(
    args: QueryDatabaseRecordsArgs,
    _context: Context,
    req: AuthedRequest,
  ) {
    return this.doQueryDatabaseRecords(requireAuth(req), args)
  }

  async doQueryDatabaseRecords(auth: AuthContext, args: QueryDatabaseRecordsArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertPageBindingAllows(auth, args.pageId)
    return this.databaseRead.query({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      filter: args.filter,
      sorts: args.sorts,
      cursor: args.cursor,
      limit: args.limit,
    })
  }
}
