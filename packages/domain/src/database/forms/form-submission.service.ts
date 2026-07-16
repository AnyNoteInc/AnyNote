import { createHash } from 'node:crypto'

import type {
  DatabaseCellWriteValue,
  DatabaseRepository,
  PropertyRow,
} from '../repositories/database.repository.ts'
import type { ItemPageCreator } from '../../shared/item-page-creator.ts'
import { DomainError, badRequest, conflict } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  FormRepositoryContract,
  FormSubmissionRecord,
  FormUploadLeaseRecord,
  FormVersionRecord,
  PublicFormRecord,
} from './database-form.repository.ts'
import type {
  FormAccessResolver,
  PublishedFormResolution,
  ReplayFormResolution,
} from './form-access-resolver.ts'
import { buildFormAnswerSchema, toPublicFormVersion } from './form-answer-schema.ts'
import { parseFormVersionDocument, type FormQuestion } from './form-document.ts'
import { evaluateFormPath } from './form-graph.ts'
import { toResolverRules } from '../services/row-post-filters.ts'
import {
  canViewRow,
  resolveRowAccess,
  type RowAccessContext,
} from '../services/row-access-resolver.ts'

export interface FormSubmissionInput {
  locator: string
  idempotencyKey: string
  answers: Record<string, unknown>
}

/** Fields extracted from an already cryptographically verified version token. */
export interface FormSubmissionTokenContext {
  locatorHash: string
  versionNumber: number
  schemaHash: string
  linkRevision: number
}

interface PreparedFormSubmissionScalarValue {
  propertyId: string
  value: DatabaseCellWriteValue
}

interface PreparedFormSubmissionRelationValue {
  propertyId: string
  targetRowIds: readonly string[]
}

interface PreparedFormSubmissionFileValue {
  propertyId: string
  questionId: string
  uploads: readonly FormUploadLeaseRecord[]
}

/**
 * Server-authoritative response data that has already passed document, path,
 * property, target, and upload validation. Public input must never be cast to
 * this shape directly; the preparation slice owns constructing it.
 */
interface PreparedFormSubmission {
  locator: string
  formId: string
  linkRevision: number
  audience: PublicFormRecord['audience']
  versionId: string
  versionNumber: number
  sourceId: string
  sourcePageId: string
  workspaceId: string
  respondentUserId: string | null
  idempotencyKey: string
  endingId: string
  title: string
  scalarValues: readonly PreparedFormSubmissionScalarValue[]
  relationValues: readonly PreparedFormSubmissionRelationValue[]
  fileValues: readonly PreparedFormSubmissionFileValue[]
  submittedAt: Date
}

export interface FormSubmissionResult {
  submissionId: string
  endingId: string
  ownResponseUrl: string | null
  created: boolean
}

export type FormFieldErrors = Readonly<Record<string, readonly string[]>>

/** Safe, question-keyed validation details suitable for a public form UI. */
export class FormValidationError extends DomainError {
  readonly fieldErrors: FormFieldErrors

  constructor(fieldErrors: FormFieldErrors) {
    super('BAD_REQUEST', 'FORM_ANSWERS_INVALID', 400, { fieldErrors })
    this.name = 'DomainError'
    this.fieldErrors = fieldErrors
  }
}

type OpenFormResolution = Extract<PublishedFormResolution, { status: 'OPEN' }>

interface SubmissionContext {
  resolved: OpenFormResolution
  version: FormVersionRecord
  acceptedAt: Date
}

type AccessibleReplayResolution = Extract<ReplayFormResolution, { status: 'ACCESSIBLE' }>

interface ReplayContext {
  resolved: AccessibleReplayResolution
  version: FormVersionRecord
  checkedAt: Date
}

const ROW_POSITION_STEP = 1_024
const SCALAR_PROPERTY_TYPES = new Set([
  'TEXT',
  'NUMBER',
  'STATUS',
  'SELECT',
  'MULTI_SELECT',
  'CHECKBOX',
  'DATE',
  'URL',
  'EMAIL',
  'PHONE',
])

const isEmptyAnswer = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

const currentOptionIds = (property: PropertyRow): Set<string> => {
  if (property.settings === null || typeof property.settings !== 'object') return new Set()
  const options = (property.settings as { options?: unknown }).options
  if (!Array.isArray(options)) return new Set()
  return new Set(
    options.flatMap((option) =>
      option !== null &&
      typeof option === 'object' &&
      typeof (option as { id?: unknown }).id === 'string'
        ? [(option as { id: string }).id]
        : [],
    ),
  )
}

const hasCurrentChoiceSnapshot = (question: FormQuestion, property: PropertyRow): boolean => {
  if (question.input.kind !== 'SINGLE_CHOICE' && question.input.kind !== 'MULTI_CHOICE') {
    return true
  }
  const ids = currentOptionIds(property)
  return question.input.options.every(({ id }) => ids.has(id))
}

const relationTargetSourceId = (property: PropertyRow): string | null => {
  if (property.settings === null || typeof property.settings !== 'object') return null
  const relation = (property.settings as { relation?: unknown }).relation
  if (relation === null || typeof relation !== 'object') return null
  const targetSourceId = (relation as { targetSourceId?: unknown }).targetSourceId
  return typeof targetSourceId === 'string' ? targetSourceId : null
}

const isUniqueConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'

export function automaticResponseTitle(now: Date): string {
  const stamp = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(now)
  return `Ответ · ${stamp} UTC`
}

function toSubmissionResult(
  submission: FormSubmissionRecord,
  resolved: AccessibleReplayResolution | OpenFormResolution,
  created: boolean,
): FormSubmissionResult {
  return {
    submissionId: submission.id,
    endingId: submission.endingId,
    ownResponseUrl:
      submission.respondentUserId !== null && resolved.form.respondentAccess !== 'NONE'
        ? `/f/${resolved.locator}/responses/${submission.id}`
        : null,
    created,
  }
}

const addFieldError = (
  errors: Record<string, string[]>,
  questionId: string,
  message: string,
): void => {
  const messages = errors[questionId]
  if (messages === undefined) errors[questionId] = [message]
  else if (!messages.includes(message)) messages.push(message)
}

const semanticError = (questionId: string, message: string): FormValidationError =>
  new FormValidationError({ [questionId]: [message] })

/** Atomic persistence half of form submission; validation is intentionally external. */
export class FormSubmissionService {
  private readonly formRepo: FormRepositoryContract
  private readonly databaseRepo: DatabaseRepository
  private readonly pageRepo: ItemPageCreator
  private readonly uow: UnitOfWork
  private readonly formAccess: FormAccessResolver
  private readonly now: () => Date

  constructor(
    formRepo: FormRepositoryContract,
    databaseRepo: DatabaseRepository,
    pageRepo: ItemPageCreator,
    uow: UnitOfWork,
    formAccess: FormAccessResolver,
    now: () => Date = () => new Date(),
  ) {
    this.formRepo = formRepo
    this.databaseRepo = databaseRepo
    this.pageRepo = pageRepo
    this.uow = uow
    this.formAccess = formAccess
    this.now = now
  }

  async submit(
    actorUserId: string | null,
    input: FormSubmissionInput,
    token: FormSubmissionTokenContext,
  ): Promise<FormSubmissionResult> {
    const replay = await this.findReplay(actorUserId, input, token)
    if (replay !== null) return replay
    const context = await this.resolveSubmissionContext(actorUserId, input, token)
    const prepared = await this.prepareSubmission(context, input)
    return this.persist(prepared, actorUserId, input, token)
  }

  private async prepareSubmission(
    context: SubmissionContext,
    input: FormSubmissionInput,
  ): Promise<PreparedFormSubmission> {
    const { resolved, version, acceptedAt } = context

    let document
    try {
      document = parseFormVersionDocument(version.schema)
    } catch {
      throw conflict('FORM_VERSION_STALE')
    }
    if (document.schemaVersion !== version.schemaVersion) throw conflict('FORM_VERSION_STALE')

    const publicVersion = toPublicFormVersion(document)
    const answersResult = buildFormAnswerSchema(publicVersion).safeParse({ answers: input.answers })
    if (!answersResult.success) {
      const fieldErrors: Record<string, string[]> = {}
      for (const issue of answersResult.error.issues) {
        const questionId = issue.path[0] === 'answers' ? issue.path[1] : undefined
        if (typeof questionId === 'string') addFieldError(fieldErrors, questionId, issue.message)
      }
      throw new FormValidationError(fieldErrors)
    }

    const path = evaluateFormPath(publicVersion, answersResult.data.answers)
    const visibleQuestionIds = new Set(path.visibleQuestionIds)
    const currentProperties = new Map(
      (await this.databaseRepo.listProperties(resolved.form.sourceId)).map((property) => [
        property.id,
        property,
      ]),
    )

    for (const question of document.questions) {
      if (question.property.kind !== 'PROPERTY') continue
      const property = currentProperties.get(question.property.propertyId)
      if (
        property === undefined ||
        property.type !== question.property.propertyType ||
        (question.property.propertyType === 'PERSON' &&
          (question.input.kind !== 'PERSON' || question.input.maxSelections !== 1)) ||
        !hasCurrentChoiceSnapshot(question, property)
      ) {
        throw conflict('FORM_PROPERTY_INVALID')
      }
    }

    const scalarValues: PreparedFormSubmissionScalarValue[] = []
    const relationValues: PreparedFormSubmissionRelationValue[] = []
    const fileValues: PreparedFormSubmissionFileValue[] = []
    let title: string | undefined
    for (const question of document.questions) {
      if (!visibleQuestionIds.has(question.id)) continue
      const value = answersResult.data.answers[question.id]
      if (question.property.kind === 'TITLE') {
        if (typeof value === 'string' && value.length > 0) title = value
        continue
      }
      if (isEmptyAnswer(value)) continue
      const propertyId = question.property.propertyId
      const property = currentProperties.get(propertyId)
      if (property === undefined) throw conflict('FORM_PROPERTY_INVALID')

      if (SCALAR_PROPERTY_TYPES.has(question.property.propertyType)) {
        scalarValues.push({
          propertyId,
          value: value as DatabaseCellWriteValue,
        })
        continue
      }

      if (question.property.propertyType === 'PERSON') {
        if (
          question.input.kind !== 'PERSON' ||
          !Array.isArray(value) ||
          value.length !== 1 ||
          typeof value[0] !== 'string' ||
          !(await this.databaseRepo.isWorkspaceMember(value[0], resolved.form.source.workspaceId))
        ) {
          throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        }
        scalarValues.push({ propertyId, value: value[0] })
        continue
      }

      if (question.property.propertyType === 'PAGE_LINK') {
        if (
          question.input.kind !== 'PAGE_LINK' ||
          typeof value !== 'string' ||
          resolved.respondentUserId === null
        ) {
          throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        }
        const accessible = await this.pageRepo.findAccessiblePageLinkIds(
          resolved.respondentUserId,
          resolved.form.source.workspaceId,
          [value],
        )
        if (!accessible.has(value)) throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        scalarValues.push({ propertyId, value })
        continue
      }

      if (question.property.propertyType === 'RELATION') {
        if (
          question.input.kind !== 'RELATION' ||
          !Array.isArray(value) ||
          !value.every((target): target is string => typeof target === 'string') ||
          resolved.respondentUserId === null
        ) {
          throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        }
        const targetSourceId = relationTargetSourceId(property)
        if (targetSourceId === null) {
          throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        }
        const targetSource = await this.databaseRepo.findSourceMetaById(targetSourceId)
        if (
          targetSource === null ||
          targetSource.workspaceId !== resolved.form.source.workspaceId
        ) {
          throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        }
        const rows = await this.databaseRepo.findRowsAccessMetaByIds(value)
        const rowsById = new Map(rows.map((row) => [row.id, row]))
        if (
          rowsById.size !== value.length ||
          value.some((targetRowId) => {
            const row = rowsById.get(targetRowId)
            return (
              row === undefined ||
              row.sourceId !== targetSourceId ||
              row.workspaceId !== resolved.form.source.workspaceId
            )
          })
        ) {
          throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        }
        const targetPageIds = [
          targetSource.pageId,
          ...value.map((targetRowId) => rowsById.get(targetRowId)!.pageId),
        ]
        const accessiblePages = await this.pageRepo.findAccessiblePageIds(
          resolved.respondentUserId,
          resolved.form.source.workspaceId,
          targetPageIds,
        )
        if (targetPageIds.some((pageId) => !accessiblePages.has(pageId))) {
          throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        }
        const rulesBySource = await this.databaseRepo.findEnabledAccessRulesForSources([
          targetSourceId,
        ])
        const rules = toResolverRules(rulesBySource.get(targetSourceId) ?? [])
        const [workspaceRole, isSourcePageCreator, shareLevels] = await Promise.all([
          this.databaseRepo.findWorkspaceRole(
            resolved.respondentUserId,
            resolved.form.source.workspaceId,
          ),
          this.databaseRepo.isSourcePageCreatedBy(targetSource.pageId, resolved.respondentUserId),
          this.databaseRepo.findItemPageShareLevels(
            value.map((targetRowId) => rowsById.get(targetRowId)!.pageId),
            resolved.respondentUserId,
          ),
        ])
        for (const targetRowId of value) {
          const row = rowsById.get(targetRowId)!
          const context: RowAccessContext = {
            viewerId: resolved.respondentUserId,
            workspaceRole,
            isSourcePageCreator,
            pageShareLevel: shareLevels.get(row.pageId) ?? null,
          }
          if (
            !canViewRow(
              resolveRowAccess(context, rules, {
                rowCreatedById: row.createdById,
                cellsByProperty: row.cellsByProperty,
              }),
            )
          ) {
            throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
          }
        }
        relationValues.push({ propertyId, targetRowIds: value })
        continue
      }

      if (question.property.propertyType === 'FILE') {
        const fileInput = question.input
        if (
          fileInput.kind !== 'FILE' ||
          !Array.isArray(value) ||
          !value.every((token): token is string => typeof token === 'string')
        ) {
          throw semanticError(question.id, 'FORM_UPLOAD_INVALID')
        }
        const tokenHashes = value.map((token) => createHash('sha256').update(token).digest('hex'))
        const uploads = await this.formRepo.resolveUploadLeases({
          formId: resolved.form.id,
          versionId: version.id,
          questionId: question.id,
          tokenHashes,
          now: acceptedAt,
        })
        const byHash = new Map(uploads.map((upload) => [upload.uploadTokenHash, upload]))
        const ordered = tokenHashes.map((hash) => byHash.get(hash))
        if (
          uploads.length !== tokenHashes.length ||
          ordered.some((upload) => upload === undefined) ||
          ordered.some(
            (upload) =>
              upload!.formId !== resolved.form.id ||
              upload!.versionId !== version.id ||
              upload!.questionId !== question.id ||
              upload!.expiresAt.getTime() <= acceptedAt.getTime() ||
              upload!.consumedAt !== null ||
              upload!.file.workspaceId !== resolved.form.source.workspaceId ||
              upload!.file.status !== 'PENDING' ||
              !fileInput.allowedMimeTypes.includes(upload!.file.mimeType) ||
              upload!.file.fileSize > BigInt(fileInput.maxBytesPerFile),
          )
        ) {
          throw semanticError(question.id, 'FORM_UPLOAD_INVALID')
        }
        fileValues.push({
          propertyId,
          questionId: question.id,
          uploads: ordered as FormUploadLeaseRecord[],
        })
        continue
      }

      throw badRequest('FORM_SEMANTIC_PREPARATION_UNSUPPORTED')
    }

    return {
      locator: resolved.locator,
      formId: resolved.form.id,
      linkRevision: resolved.form.linkRevision,
      audience: resolved.form.audience,
      versionId: version.id,
      versionNumber: version.versionNumber,
      sourceId: resolved.form.sourceId,
      sourcePageId: resolved.form.source.pageId,
      workspaceId: resolved.form.source.workspaceId,
      respondentUserId: resolved.respondentUserId,
      idempotencyKey: input.idempotencyKey,
      endingId: path.endingId,
      title: title ?? automaticResponseTitle(acceptedAt),
      scalarValues,
      relationValues,
      fileValues,
      submittedAt: acceptedAt,
    }
  }

  async findReplay(
    actorUserId: string | null,
    input: FormSubmissionInput,
    token: FormSubmissionTokenContext,
  ): Promise<FormSubmissionResult | null> {
    const { resolved, version } = await this.resolveReplayContext(actorUserId, input, token)
    const replay = await this.formRepo.findSubmissionByIdempotency(
      resolved.form.id,
      input.idempotencyKey,
    )
    if (replay === null) return null
    this.assertReplayIdentity(replay, version.id, resolved.respondentUserId)
    return toSubmissionResult(replay, resolved, false)
  }

  private async persist(
    prepared: PreparedFormSubmission,
    actorUserId: string | null,
    input: FormSubmissionInput,
    token: FormSubmissionTokenContext,
  ): Promise<FormSubmissionResult> {
    try {
      return await this.uow.transaction(async () => {
        const locked = await this.formRepo.lockSubmissionContext({
          formId: prepared.formId,
          workspaceId: prepared.workspaceId,
          pageId: prepared.sourcePageId,
          actorUserId,
        })
        if (!locked) throw conflict('FORM_NOT_ACCEPTING')

        // A committed key wins even if the form became CLOSED/CAPPED/scheduled
        // after the original response. The signed locator/version context and
        // current respondent authority are still revalidated before lookup.
        const replayContext = await this.resolveReplayContext(actorUserId, input, token)
        this.assertSameFormIdentity(prepared, replayContext.resolved, replayContext.version)

        const replay = await this.formRepo.findSubmissionByIdempotency(
          prepared.formId,
          prepared.idempotencyKey,
        )
        if (replay !== null) {
          this.assertReplayIdentity(
            replay,
            replayContext.version.id,
            replayContext.resolved.respondentUserId,
          )
          return toSubmissionResult(replay, replayContext.resolved, false)
        }

        // Everything consumed by writes is authoritatively rebuilt after the
        // workspace-first lock, using the transaction-bound repositories.
        const context = await this.resolveSubmissionContext(actorUserId, input, token)
        this.assertSameFormIdentity(prepared, context.resolved, context.version)
        const effective = await this.prepareSubmission(context, input)

        const reserved = await this.formRepo.reserveResponseSlot({
          formId: effective.formId,
          now: effective.submittedAt,
          expectedLinkRevision: effective.linkRevision,
          expectedAudience: effective.audience,
        })
        if (!reserved) throw conflict('FORM_NOT_ACCEPTING')

        const itemPage = await this.pageRepo.createItemPageTx(
          effective.sourcePageId,
          effective.workspaceId,
          effective.respondentUserId,
        )
        const maxPosition = await this.databaseRepo.maxRowPosition(effective.sourceId)
        const row = await this.databaseRepo.createRow({
          sourceId: effective.sourceId,
          pageId: itemPage.id,
          position: maxPosition + ROW_POSITION_STEP,
          createdById: effective.respondentUserId,
        })
        await this.databaseRepo.updatePageTitle(
          itemPage.id,
          effective.title,
          effective.respondentUserId,
        )
        for (const scalar of effective.scalarValues) {
          await this.databaseRepo.upsertCellValue(row.id, scalar.propertyId, scalar.value)
        }
        for (const relation of effective.relationValues) {
          await this.databaseRepo.replaceRelationLinks({
            propertyId: relation.propertyId,
            rowId: row.id,
            targetRowIds: [...relation.targetRowIds],
          })
        }
        for (const file of effective.fileValues) {
          await this.formRepo.consumeUploadLeases({
            formId: effective.formId,
            versionId: effective.versionId,
            questionId: file.questionId,
            workspaceId: effective.workspaceId,
            uploads: file.uploads,
            pageId: itemPage.id,
            consumedAt: effective.submittedAt,
          })
          await this.databaseRepo.upsertFileCellValue(
            row.id,
            file.propertyId,
            file.uploads.map(({ fileId }) => fileId),
          )
        }

        const submission = await this.formRepo.createSubmission({
          formId: effective.formId,
          versionId: effective.versionId,
          rowId: row.id,
          respondentUserId: effective.respondentUserId,
          endingId: effective.endingId,
          idempotencyKey: effective.idempotencyKey,
          submittedAt: effective.submittedAt,
        })
        await this.formRepo.enqueueFormSubmittedEvent({
          formId: effective.formId,
          versionNumber: effective.versionNumber,
          sourceId: effective.sourceId,
          sourcePageId: effective.sourcePageId,
          workspaceId: effective.workspaceId,
          rowId: row.id,
          itemPageId: itemPage.id,
          submissionId: submission.id,
          respondentUserId: effective.respondentUserId,
          submittedAt: effective.submittedAt,
        })
        return toSubmissionResult(submission, context.resolved, true)
      })
    } catch (error) {
      if (!isUniqueConflict(error)) throw error
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const replayContext = await this.resolveReplayContext(actorUserId, input, token)
        const replay = await this.formRepo.findSubmissionByIdempotency(
          prepared.formId,
          prepared.idempotencyKey,
        )
        if (replay !== null) {
          this.assertReplayIdentity(
            replay,
            replayContext.version.id,
            replayContext.resolved.respondentUserId,
          )
          return toSubmissionResult(replay, replayContext.resolved, false)
        }
        await Promise.resolve()
      }
      throw error
    }
  }

  private assertSameFormIdentity(
    prepared: PreparedFormSubmission,
    resolved: AccessibleReplayResolution | OpenFormResolution,
    version: FormVersionRecord,
  ): void {
    if (
      resolved.form.id !== prepared.formId ||
      resolved.form.sourceId !== prepared.sourceId ||
      resolved.form.source.pageId !== prepared.sourcePageId ||
      resolved.form.source.workspaceId !== prepared.workspaceId ||
      resolved.form.audience !== prepared.audience ||
      resolved.respondentUserId !== prepared.respondentUserId
    ) {
      throw conflict('FORM_NOT_ACCEPTING')
    }
    if (version.id !== prepared.versionId) throw conflict('FORM_VERSION_STALE')
  }

  private assertReplayIdentity(
    replay: FormSubmissionRecord,
    versionId: string,
    respondentUserId: string | null,
  ): void {
    if (replay.versionId !== versionId || replay.respondentUserId !== respondentUserId) {
      throw conflict('FORM_IDEMPOTENCY_CONFLICT')
    }
  }

  private async resolveSubmissionContext(
    actorUserId: string | null,
    input: FormSubmissionInput,
    token: FormSubmissionTokenContext,
  ): Promise<SubmissionContext> {
    const resolved = await this.formAccess.resolvePublished(input.locator, actorUserId)
    if (resolved.status !== 'OPEN') throw conflict('FORM_NOT_ACCEPTING')

    const locatorHash = createHash('sha256').update(resolved.locator).digest('hex')
    if (token.locatorHash !== locatorHash || resolved.form.linkRevision !== token.linkRevision) {
      throw conflict('FORM_VERSION_STALE')
    }

    const version = await this.formAccess.resolveVersion(resolved.form, token.versionNumber)
    if (
      version === null ||
      version.versionNumber !== token.versionNumber ||
      version.schemaHash !== token.schemaHash
    ) {
      throw conflict('FORM_VERSION_STALE')
    }

    const acceptedAt = this.now()
    const isCurrent = resolved.form.publishedVersionId === version.id
    const isLiveGrace =
      !isCurrent &&
      version.acceptUntil !== null &&
      version.acceptUntil.getTime() > acceptedAt.getTime()
    if (!isCurrent && !isLiveGrace) throw conflict('FORM_VERSION_STALE')

    return { resolved, version, acceptedAt }
  }

  private async resolveReplayContext(
    actorUserId: string | null,
    input: FormSubmissionInput,
    token: FormSubmissionTokenContext,
  ): Promise<ReplayContext> {
    const resolved = await this.formAccess.resolveReplay(input.locator, actorUserId)
    if (resolved.status !== 'ACCESSIBLE') throw conflict('FORM_NOT_ACCEPTING')

    const locatorHash = createHash('sha256').update(resolved.locator).digest('hex')
    if (token.locatorHash !== locatorHash || resolved.form.linkRevision !== token.linkRevision) {
      throw conflict('FORM_VERSION_STALE')
    }
    const version = await this.formAccess.resolveVersion(resolved.form, token.versionNumber)
    if (
      version === null ||
      version.versionNumber !== token.versionNumber ||
      version.schemaHash !== token.schemaHash
    ) {
      throw conflict('FORM_VERSION_STALE')
    }
    const checkedAt = this.now()
    const isCurrent = resolved.form.publishedVersionId === version.id
    const isLiveGrace =
      !isCurrent &&
      version.acceptUntil !== null &&
      version.acceptUntil.getTime() > checkedAt.getTime()
    if (!isCurrent && !isLiveGrace) throw conflict('FORM_VERSION_STALE')
    return { resolved, version, checkedAt }
  }
}
