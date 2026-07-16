import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import {
  buildPageVisibilityWhere,
  excludeDatabaseRowPages,
  propertySettingsSchema,
} from '@repo/domain'
import {
  parseFormVersionDocument,
  toPublicFormVersion,
} from '@repo/domain/database/forms'

import { domain as domainSvc } from '../domain'
import {
  assertFormVersionContext,
  hashFormLocator,
  signFormVersionToken,
  verifyFormVersionToken,
} from '../helpers/form-version-token'
import { publicProcedure, router } from '../trpc'

const FORM_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000
const pickerCursorSchema = z.string().uuid()

const listPickerOptionsInput = z.object({
  locator: z.string(),
  versionToken: z.string().min(1).max(4_096),
  questionId: z.string().min(1).max(64),
  query: z.string().trim().max(200).optional(),
  cursor: pickerCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
})

type PickerOption = { id: string; label: string }
type PickerPage = { items: PickerOption[]; nextCursor: string | null }

function tokenSecret(): string {
  return process.env.FORM_TOKEN_SECRET ?? ''
}

function pickerUnavailable(): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: 'FORM_PICKER_UNAVAILABLE' })
}

function pageOf(options: PickerOption[], limit: number): PickerPage {
  const hasMore = options.length > limit
  const items = hasMore ? options.slice(0, limit) : options
  return {
    items,
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  }
}

function displayLabel(label: string | null): string {
  return label?.trim() || 'Без названия'
}

function signResolvedVersion(
  resolved: Extract<
    Awaited<ReturnType<typeof domainSvc.formAccess.resolvePublished>>,
    { status: 'OPEN' }
  >,
): string {
  const issuedAt = Date.now()
  return signFormVersionToken(
    {
      locatorHash: hashFormLocator(resolved.locator),
      versionNumber: resolved.version.versionNumber,
      schemaHash: resolved.version.schemaHash,
      linkRevision: resolved.form.linkRevision,
      issuedAt,
      expiresAt: issuedAt + FORM_TOKEN_TTL_MS,
    },
    tokenSecret(),
  )
}

async function listRelationOptions(
  actorUserId: string,
  pageId: string,
  input: z.infer<typeof listPickerOptionsInput>,
): Promise<PickerPage> {
  const query = input.query?.toLowerCase()
  const options: PickerOption[] = []
  const batchLimit = Math.min(Math.max(input.limit * 5 + 1, 51), 200)

  const page = await domainSvc.database.listRows(actorUserId, {
    pageId,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    limit: batchLimit,
  })
  for (const row of page.rows) {
    const label = displayLabel(row.title)
    if (query === undefined || label.toLowerCase().includes(query)) {
      options.push({ id: row.rowId, label })
    }
  }
  if (options.length > input.limit) return pageOf(options, input.limit)
  return { items: options, nextCursor: page.nextCursor }
}

export const formRouter = router({
  getPublished: publicProcedure
    .input(z.object({ locator: z.string() }))
    .query(async ({ ctx, input }) => {
      ctx.resHeaders.set('Cache-Control', 'private, no-store')
      const resolved = await domainSvc.formAccess.resolvePublished(
        input.locator,
        ctx.user?.id ?? null,
      )
      if (resolved.status !== 'OPEN') return resolved

      return {
        status: 'OPEN' as const,
        version: toPublicFormVersion(parseFormVersionDocument(resolved.version.schema)),
        versionFingerprint: resolved.version.schemaHash,
        versionToken: signResolvedVersion(resolved),
        respondentKind: resolved.respondentUserId
          ? ('authenticated' as const)
          : ('anonymous' as const),
      }
    }),

  listPickerOptions: publicProcedure
    .input(listPickerOptionsInput)
    .query(async ({ ctx, input }): Promise<PickerPage> => {
      ctx.resHeaders.set('Cache-Control', 'private, no-store')

      let token
      try {
        token = verifyFormVersionToken(input.versionToken, tokenSecret())
      } catch {
        throw pickerUnavailable()
      }

      const actorUserId = ctx.user?.id ?? null
      const resolved = await domainSvc.formAccess.resolvePublished(input.locator, actorUserId)
      if (
        resolved.status !== 'OPEN' ||
        resolved.form.audience !== 'WORKSPACE_MEMBERS_WITH_LINK' ||
        resolved.respondentUserId === null
      ) {
        throw pickerUnavailable()
      }

      const storedVersion = await domainSvc.formAccess.resolveVersion(
        resolved.form,
        token.versionNumber,
      )
      if (storedVersion === null || storedVersion.formId !== resolved.form.id) {
        throw pickerUnavailable()
      }

      try {
        assertFormVersionContext(token, {
          locatorHash: hashFormLocator(resolved.locator),
          versionNumber: storedVersion.versionNumber,
          schemaHash: storedVersion.schemaHash,
          linkRevision: resolved.form.linkRevision,
          isCurrent: storedVersion.id === resolved.form.publishedVersionId,
          acceptUntil: storedVersion.acceptUntil,
        })
      } catch {
        throw pickerUnavailable()
      }

      const document = parseFormVersionDocument(storedVersion.schema)
      const question = document.questions.find(({ id }) => id === input.questionId)
      if (
        question?.property.kind !== 'PROPERTY' ||
        (question.property.propertyType !== 'PERSON' &&
          question.property.propertyType !== 'RELATION' &&
          question.property.propertyType !== 'PAGE_LINK')
      ) {
        throw pickerUnavailable()
      }

      const property = await ctx.prisma.databaseProperty.findFirst({
        where: {
          id: question.property.propertyId,
          sourceId: resolved.form.sourceId,
          type: question.property.propertyType,
        },
        select: { id: true, type: true, settings: true },
      })
      if (property === null) throw pickerUnavailable()

      if (question.property.propertyType === 'PERSON') {
        const users = await ctx.prisma.user.findMany({
          where: {
            ...(input.cursor === undefined ? {} : { id: { gt: input.cursor } }),
            ...(input.query
              ? { name: { contains: input.query, mode: 'insensitive' as const } }
              : {}),
            workspaceMemberships: { some: { workspaceId: resolved.form.source.workspaceId } },
            workspaceBlocks: { none: { workspaceId: resolved.form.source.workspaceId } },
          },
          orderBy: { id: 'asc' },
          take: input.limit + 1,
          select: { id: true, name: true },
        })
        return pageOf(
          users.map(({ id, name }) => ({ id, label: displayLabel(name) })),
          input.limit,
        )
      }

      if (question.property.propertyType === 'RELATION') {
        const settings = propertySettingsSchema.safeParse(property.settings)
        const targetSourceId = settings.success ? settings.data.relation?.targetSourceId : undefined
        if (targetSourceId === undefined) throw pickerUnavailable()
        const target = await ctx.prisma.databaseSource.findFirst({
          where: {
            id: targetSourceId,
            workspaceId: resolved.form.source.workspaceId,
            page: {
              archivedAt: null,
              deletedAt: null,
              AND: [buildPageVisibilityWhere(resolved.respondentUserId)],
            },
          },
          select: { id: true, pageId: true },
        })
        if (target === null) throw pickerUnavailable()
        return listRelationOptions(resolved.respondentUserId, target.pageId, input)
      }

      const pages = await ctx.prisma.page.findMany({
        where: {
          workspaceId: resolved.form.source.workspaceId,
          archivedAt: null,
          deletedAt: null,
          isTemplate: null,
          ...(input.cursor === undefined ? {} : { id: { gt: input.cursor } }),
          ...(input.query
            ? { title: { contains: input.query, mode: 'insensitive' as const } }
            : {}),
          AND: [buildPageVisibilityWhere(resolved.respondentUserId), excludeDatabaseRowPages()],
        },
        orderBy: { id: 'asc' },
        take: input.limit + 1,
        select: { id: true, title: true },
      })
      return pageOf(
        pages.map(({ id, title }) => ({ id, label: displayLabel(title) })),
        input.limit,
      )
    }),
})
