import { createHash } from 'node:crypto'

import type {
  DatabaseCellWriteValue,
  DatabaseRepository,
  PropertyRow,
} from '../repositories/database.repository.ts'
import type { ItemPageCreator } from '../../shared/item-page-creator.ts'
import { badRequest, conflict } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  FormRepositoryContract,
  FormSubmissionRecord,
  FormVersionRecord,
  PublicFormRecord,
} from './database-form.repository.ts'
import type { FormAccessResolver, PublishedFormResolution } from './form-access-resolver.ts'
import { buildFormAnswerSchema, toPublicFormVersion } from './form-answer-schema.ts'
import { parseFormVersionDocument, type FormQuestion } from './form-document.ts'
import { evaluateFormPath } from './form-graph.ts'

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

export interface PreparedFormSubmissionScalarValue {
  propertyId: string
  value: DatabaseCellWriteValue
}

/**
 * Server-authoritative response data that has already passed document, path,
 * property, target, and upload validation. Public input must never be cast to
 * this shape directly; the preparation slice owns constructing it.
 */
export interface PreparedFormSubmission {
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
  submittedAt: Date
}

export interface FormSubmissionResult {
  submissionId: string
  rowId: string
  pageId: string
  endingId: string
  submittedAt: Date
  created: boolean
}

type OpenFormResolution = Extract<PublishedFormResolution, { status: 'OPEN' }>

interface SubmissionContext {
  resolved: OpenFormResolution
  version: FormVersionRecord
  acceptedAt: Date
}

interface TransactionalRevalidation {
  actorUserId: string | null
  input: FormSubmissionInput
  token: FormSubmissionTokenContext
  automaticTitle: boolean
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
  created: boolean,
): FormSubmissionResult {
  return {
    submissionId: submission.id,
    rowId: submission.rowId,
    pageId: submission.row.pageId,
    endingId: submission.endingId,
    submittedAt: submission.submittedAt,
    created,
  }
}

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
    const { resolved, version, acceptedAt } = await this.resolveSubmissionContext(
      actorUserId,
      input,
      token,
    )

    let document
    try {
      document = parseFormVersionDocument(version.schema)
    } catch {
      throw conflict('FORM_VERSION_STALE')
    }
    if (document.schemaVersion !== version.schemaVersion) throw conflict('FORM_VERSION_STALE')

    const publicVersion = toPublicFormVersion(document)
    const answersResult = buildFormAnswerSchema(publicVersion).safeParse({ answers: input.answers })
    if (!answersResult.success) throw badRequest('FORM_ANSWERS_INVALID')

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
        !hasCurrentChoiceSnapshot(question, property)
      ) {
        throw conflict('FORM_PROPERTY_INVALID')
      }
    }

    const scalarValues: PreparedFormSubmissionScalarValue[] = []
    let title: string | undefined
    for (const question of document.questions) {
      if (!visibleQuestionIds.has(question.id)) continue
      const value = answersResult.data.answers[question.id]
      if (question.property.kind === 'TITLE') {
        if (typeof value === 'string' && value.length > 0) title = value
        continue
      }
      if (isEmptyAnswer(value)) continue
      if (!SCALAR_PROPERTY_TYPES.has(question.property.propertyType)) {
        throw badRequest('FORM_SEMANTIC_PREPARATION_UNSUPPORTED')
      }
      scalarValues.push({
        propertyId: question.property.propertyId,
        value: value as DatabaseCellWriteValue,
      })
    }

    return this.persist(
      {
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
        submittedAt: acceptedAt,
      },
      { actorUserId, input, token, automaticTitle: title === undefined },
    )
  }

  persistPrepared(prepared: PreparedFormSubmission): Promise<FormSubmissionResult> {
    return this.persist(prepared)
  }

  private persist(
    prepared: PreparedFormSubmission,
    revalidation?: TransactionalRevalidation,
  ): Promise<FormSubmissionResult> {
    return this.uow.transaction(async () => {
      let effective = prepared
      if (revalidation !== undefined) {
        const locked = await this.formRepo.lockSubmissionContext({
          formId: prepared.formId,
          workspaceId: prepared.workspaceId,
          pageId: prepared.sourcePageId,
          actorUserId: revalidation.actorUserId,
        })
        if (!locked) throw conflict('FORM_NOT_ACCEPTING')

        const context = await this.resolveSubmissionContext(
          revalidation.actorUserId,
          revalidation.input,
          revalidation.token,
        )
        if (
          context.resolved.form.id !== prepared.formId ||
          context.resolved.form.sourceId !== prepared.sourceId ||
          context.resolved.form.source.pageId !== prepared.sourcePageId ||
          context.resolved.form.source.workspaceId !== prepared.workspaceId ||
          context.resolved.form.audience !== prepared.audience ||
          context.resolved.respondentUserId !== prepared.respondentUserId
        ) {
          throw conflict('FORM_NOT_ACCEPTING')
        }
        if (context.version.id !== prepared.versionId) throw conflict('FORM_VERSION_STALE')

        effective = {
          ...prepared,
          submittedAt: context.acceptedAt,
          title: revalidation.automaticTitle
            ? automaticResponseTitle(context.acceptedAt)
            : prepared.title,
        }
      }

      const replay = await this.formRepo.findSubmissionByIdempotency(
        effective.formId,
        effective.idempotencyKey,
      )
      if (replay !== null) return toSubmissionResult(replay, false)

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
      return toSubmissionResult(submission, true)
    })
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
}
