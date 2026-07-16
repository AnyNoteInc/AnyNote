import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import {
  buildPageVisibilityWhere,
  excludeDatabaseRowPages,
  isDomainError,
  propertySettingsSchema,
} from '@repo/domain'
import {
  normalizeFormLocator,
  parseFormVersionDocument,
  toPublicFormVersion,
} from '@repo/domain/database/forms'

import { domain as domainSvc } from '../domain'
import { verifyFormCaptcha } from '../helpers/form-captcha'
import { formClientIp, formRateLimiter, type FormRateLimiter } from '../helpers/form-rate-limit'
import {
  assertFormVersionContext,
  hashFormLocator,
  signFormVersionToken,
  verifyFormVersionToken,
} from '../helpers/form-version-token'
import { mapDomain } from '../helpers/map-domain'
import { publicProcedure, router } from '../trpc'

const FORM_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000
const MAX_SERIALIZED_ANSWERS_BYTES = 1_048_576
const MAX_ANSWER_KEYS = 500
const UNAVAILABLE_FORM_RATE_KEY = 'unavailable'
const pickerCursorSchema = z.string().uuid()

const submitInputSchema = z
  .object({
    locator: z.string().trim().min(1).max(200),
    versionToken: z.string().min(1).max(4_096),
    idempotencyKey: z.string().uuid(),
    answers: z
      .record(z.string().min(1).max(64), z.unknown())
      .refine((answers) => Object.keys(answers).length <= MAX_ANSWER_KEYS, {
        message: 'FORM_TOO_MANY_ANSWERS',
      }),
    honeypot: z.string().max(512),
  })
  .strict()

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
type FormSubmissionInput = {
  locator: string
  idempotencyKey: string
  answers: Record<string, unknown>
}
type SubmitFormResult = {
  submissionId: string
  endingId: string
  ownResponseUrl: string | null
  created: boolean
}

type FormRouterDomain = Pick<typeof domainSvc, 'database' | 'formAccess' | 'formSubmissions'>

type FormRouterDependencies = {
  domain: FormRouterDomain
  rateLimiter: FormRateLimiter
  verifyCaptcha: typeof verifyFormCaptcha
  now: () => number
}

const defaultDependencies: FormRouterDependencies = {
  domain: domainSvc,
  rateLimiter: formRateLimiter,
  verifyCaptcha: verifyFormCaptcha,
  now: Date.now,
}

function tokenSecret(): string {
  return process.env.FORM_TOKEN_SECRET ?? ''
}

function pickerUnavailable(): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: 'FORM_PICKER_UNAVAILABLE' })
}

function formProtected(): TRPCError {
  return new TRPCError({ code: 'FORBIDDEN', message: 'FORM_PROTECTED' })
}

function formRefreshRequired(): TRPCError {
  return new TRPCError({ code: 'PRECONDITION_FAILED', message: 'FORM_REFRESH_REQUIRED' })
}

function formAnswersTooLarge(): TRPCError {
  return new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'FORM_ANSWERS_TOO_LARGE' })
}

function assertSerializedAnswersSize(answers: Record<string, unknown>): void {
  let serialized: string
  try {
    serialized = JSON.stringify(answers)
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'FORM_ANSWERS_INVALID' })
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_ANSWERS_BYTES) {
    throw formAnswersTooLarge()
  }
}

function toDomainSubmissionInput(input: z.infer<typeof submitInputSchema>): FormSubmissionInput {
  return {
    locator: input.locator,
    idempotencyKey: input.idempotencyKey,
    answers: input.answers,
  }
}

function toSubmitFormResult(result: SubmitFormResult): SubmitFormResult {
  return {
    submissionId: result.submissionId,
    endingId: result.endingId,
    ownResponseUrl: result.ownResponseUrl,
    created: result.created,
  }
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
  domain: FormRouterDomain,
  actorUserId: string,
  pageId: string,
  input: z.infer<typeof listPickerOptionsInput>,
): Promise<PickerPage> {
  const query = input.query?.toLowerCase()
  const options: PickerOption[] = []
  const batchLimit = Math.min(Math.max(input.limit * 5 + 1, 51), 200)

  const page = await domain.database.listRows(actorUserId, {
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

export function createFormRouter(overrides: Partial<FormRouterDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  const domain = dependencies.domain

  return router({
    getPublished: publicProcedure
      .input(z.object({ locator: z.string() }))
      .query(async ({ ctx, input }) => {
        ctx.resHeaders.set('Cache-Control', 'private, no-store')
        const resolved = await domain.formAccess.resolvePublished(
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
        const resolved = await domain.formAccess.resolvePublished(input.locator, actorUserId)
        if (
          resolved.status !== 'OPEN' ||
          resolved.form.audience !== 'WORKSPACE_MEMBERS_WITH_LINK' ||
          resolved.respondentUserId === null
        ) {
          throw pickerUnavailable()
        }

        const storedVersion = await domain.formAccess.resolveVersion(
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
          const targetSourceId = settings.success
            ? settings.data.relation?.targetSourceId
            : undefined
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
          return listRelationOptions(domain, resolved.respondentUserId, target.pageId, input)
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

    submit: publicProcedure.input(submitInputSchema).mutation(async ({ ctx, input }) => {
      ctx.resHeaders.set('Cache-Control', 'private, no-store')

      assertSerializedAnswersSize(input.answers)
      if (input.honeypot.length > 0) throw formProtected()

      const actorUserId = ctx.user?.id ?? null
      const submissionInput = toDomainSubmissionInput(input)
      const resolved = await domain.formAccess.resolvePublished(input.locator, actorUserId)
      const rateFormKey = resolved.status === 'OPEN' ? resolved.form.id : UNAVAILABLE_FORM_RATE_KEY
      const clientIp = formClientIp(ctx.headers)
      const now = dependencies.now()

      let token: ReturnType<typeof verifyFormVersionToken> | null = null
      let replayVersionStale = false
      try {
        token = verifyFormVersionToken(input.versionToken, tokenSecret(), now)
      } catch {
        token = null
      }

      const normalizedLocator = normalizeFormLocator(input.locator)
      if (
        token !== null &&
        normalizedLocator !== null &&
        hashFormLocator(normalizedLocator) === token.locatorHash &&
        dependencies.rateLimiter.consume('replay-ip', clientIp, now)
      ) {
        try {
          const replay = await domain.formSubmissions.findReplay(
            actorUserId,
            submissionInput,
            token,
          )
          if (replay !== null) return toSubmitFormResult(replay)
        } catch (error) {
          // Context can change between the public lookup and the replay lookup. Do not
          // turn that race into a pre-CAPTCHA oracle; the authoritative submit below
          // will return the public error after the normal protection boundary.
          if (!isDomainError(error)) {
            throw error
          }
          if (error.message === 'FORM_VERSION_STALE') replayVersionStale = true
          else if (
            error.message !== 'FORM_NOT_ACCEPTING' &&
            error.message !== 'FORM_IDEMPOTENCY_CONFLICT'
          ) {
            throw error
          }
        }
      }

      if (
        !dependencies.rateLimiter.consume('submit-ip', `${rateFormKey}:${clientIp}`, now)
      ) {
        throw formProtected()
      }
      if (!dependencies.rateLimiter.consume('submit-form', rateFormKey, now)) {
        throw formProtected()
      }

      try {
        await dependencies.verifyCaptcha({
          token: ctx.headers.get('x-captcha-response'),
          action: 'form_submit',
          headers: ctx.headers,
        })
      } catch {
        throw formProtected()
      }

      if (token === null || replayVersionStale) {
        throw formRefreshRequired()
      }

      const result = await mapDomain(() =>
        domain.formSubmissions.submit(actorUserId, submissionInput, token),
      )
      return toSubmitFormResult(result)
    }),
  })
}

export const formRouter = createFormRouter()
