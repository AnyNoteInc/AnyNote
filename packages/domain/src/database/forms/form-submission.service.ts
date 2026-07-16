import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type {
  DatabaseCellWriteValue,
  DatabaseRepository,
  PropertyRow,
} from '../repositories/database.repository.ts'
import type { ItemPageCreator } from '../../shared/item-page-creator.ts'
import { DomainError, badRequest, conflict, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  FormRepositoryContract,
  FormSubmissionRecord,
  FormUploadLeaseRecord,
  FormVersionRecord,
  OwnResponseSubmissionRecord,
  PublicFormRecord,
} from './database-form.repository.ts'
import type {
  FormAccessResolver,
  PublishedFormResolution,
  ReplayFormResolution,
  OwnResponseResolution,
} from './form-access-resolver.ts'
import { buildFormAnswerSchema, toPublicFormVersion } from './form-answer-schema.ts'
import {
  parseFormVersionDocument,
  type FormCondition,
  type FormConditionGroup,
  type FormConditionNode,
  type FormQuestion,
  type FormTransition,
} from './form-document.ts'
import { evaluateCondition, evaluateFormPath, type PublicFormVersion } from './form-graph.ts'
import {
  openOwnResponseSelection,
  sealOwnResponseSelection,
  type OwnResponseSelectionKind,
} from './own-response-selection-token.ts'
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
  retainedFileIds: readonly string[]
  uploads: readonly FormUploadLeaseRecord[]
}

interface SubmissionAuthoritySnapshot {
  personUserIds: readonly string[]
  collectionIds: readonly string[]
  parentPageIds: readonly string[]
  sourceIds: readonly string[]
  propertyIds: readonly string[]
  rowIds: readonly string[]
  pageIds: readonly string[]
  uploadIds: readonly string[]
  fileIds: readonly string[]
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
  authorities: SubmissionAuthoritySnapshot
  submittedAt: Date
  visibleQuestionIds: readonly string[]
}

interface PrepareSubmissionOptions {
  unavailableQuestionIds?: ReadonlySet<string>
  retainedFilesByQuestion?: ReadonlyMap<string, ReadonlyMap<string, string>>
  lockedAnswers?: Readonly<Record<string, unknown>>
  ownUploadBinding?: Omit<OwnResponseUploadBinding, 'questionId'>
}

export interface OwnResponseInput {
  locator: string
  submissionId: string
}

export interface UpdateOwnResponseInput extends OwnResponseInput {
  expectedRevision: string
  answers: Record<string, unknown>
  confirmClearUnreachable?: boolean
}

export interface OwnResponseFile {
  handle: string
  name: string
  mimeType: string
  size: number
}

export interface OwnResponseSelectedOption {
  value: string
  label: string
}

export interface OwnResponseDto {
  status: 'VIEW' | 'EDIT'
  revision: string
  versionNumber: number
  versionFingerprint: string
  version: Omit<ReturnType<typeof toPublicFormVersion>, 'questions'> & {
    questions: (ReturnType<typeof toPublicFormVersion>['questions'][number] & {
      available: boolean
    })[]
  }
  answers: Record<string, unknown>
  files: Record<string, OwnResponseFile[]>
  selectedOptions: Record<string, OwnResponseSelectedOption[]>
}

export type UpdateOwnResponseResult =
  { status: 'CONFIRM_CLEAR_REQUIRED'; questionIds: string[] } | { status: 'UPDATED' }

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
type AccessibleOwnResponseResolution = Extract<OwnResponseResolution, { status: 'VIEW' | 'EDIT' }>

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

const relationBackPropertyId = (property: PropertyRow): string | null => {
  if (property.settings === null || typeof property.settings !== 'object') return null
  const relation = (property.settings as { relation?: unknown }).relation
  if (relation === null || typeof relation !== 'object') return null
  const backPropertyId = (relation as { backRelationPropertyId?: unknown }).backRelationPropertyId
  return typeof backPropertyId === 'string' ? backPropertyId : null
}

const isUniqueConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort()

const sameAuthorities = (
  left: SubmissionAuthoritySnapshot,
  right: SubmissionAuthoritySnapshot,
): boolean =>
  (Object.keys(left) as (keyof SubmissionAuthoritySnapshot)[]).every(
    (key) =>
      left[key].length === right[key].length &&
      left[key].every((value, index) => value === right[key][index]),
  )

const ownResponseUnavailable = (): DomainError => notFound('FORM_RESPONSE_NOT_FOUND')

const canonicalJson = (value: unknown): string => {
  const normalize = (candidate: unknown): unknown => {
    if (typeof candidate === 'bigint') return candidate.toString()
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (candidate !== null && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      )
    }
    return candidate
  }
  return JSON.stringify(normalize(value))
}

type SimplifiedConditionNode = boolean | FormConditionNode

const simplifyOwnResponseConditionNode = (
  node: FormConditionNode,
  unavailableQuestionIds: ReadonlySet<string>,
  lockedAnswers: Readonly<Record<string, unknown>>,
): SimplifiedConditionNode => {
  if (node.kind !== 'ALL' && node.kind !== 'ANY') {
    return unavailableQuestionIds.has(node.questionId)
      ? evaluateCondition(node as FormCondition, { ...lockedAnswers })
      : node
  }

  const members = node.members.map((member) =>
    simplifyOwnResponseConditionNode(member, unavailableQuestionIds, lockedAnswers),
  )
  if (node.kind === 'ALL') {
    if (members.includes(false)) return false
    const remaining = members.filter((member): member is FormConditionNode => member !== true)
    return remaining.length === 0 ? true : { kind: 'ALL', members: remaining }
  }

  if (members.includes(true)) return true
  const remaining = members.filter((member): member is FormConditionNode => member !== false)
  return remaining.length === 0 ? false : { kind: 'ANY', members: remaining }
}

const simplifyOwnResponseConditionGroup = (
  group: FormConditionGroup,
  unavailableQuestionIds: ReadonlySet<string>,
  lockedAnswers: Readonly<Record<string, unknown>>,
): boolean | FormConditionGroup => {
  const simplified = simplifyOwnResponseConditionNode(group, unavailableQuestionIds, lockedAnswers)
  if (typeof simplified === 'boolean') return simplified
  if (simplified.kind === 'ALL' || simplified.kind === 'ANY') return simplified
  return { kind: 'ALL', members: [simplified] }
}

const orderedOwnResponseTransitions = (transitions: readonly FormTransition[]): FormTransition[] =>
  [...transitions].sort((left, right) => {
    const leftFallback = left.when === null ? 1 : 0
    const rightFallback = right.when === null ? 1 : 0
    return (
      leftFallback - rightFallback ||
      left.priority - right.priority ||
      left.id.localeCompare(right.id)
    )
  })

/** Keep branch behavior without exposing values of inaccessible controller questions. */
const sanitizeOwnResponseVersion = (
  version: PublicFormVersion,
  unavailableQuestionIds: ReadonlySet<string>,
  lockedAnswers: Readonly<Record<string, unknown>>,
): PublicFormVersion => {
  const hiddenByVisibility = new Set<string>()
  const questions = version.questions.map((question) => {
    if (question.visibleWhen === undefined) return question
    const visibleWhen = simplifyOwnResponseConditionGroup(
      question.visibleWhen,
      unavailableQuestionIds,
      lockedAnswers,
    )
    if (visibleWhen === false) hiddenByVisibility.add(question.id)
    return visibleWhen === true || visibleWhen === false
      ? { ...question, visibleWhen: undefined }
      : { ...question, visibleWhen }
  })

  const transitions: FormTransition[] = []
  const transitionsBySection = new Map<string, FormTransition[]>()
  for (const transition of version.transitions) {
    const existing = transitionsBySection.get(transition.fromSectionId) ?? []
    existing.push(transition)
    transitionsBySection.set(transition.fromSectionId, existing)
  }
  for (const section of version.sections) {
    for (const transition of orderedOwnResponseTransitions(
      transitionsBySection.get(section.id) ?? [],
    )) {
      if (transition.when === null) {
        transitions.push(transition)
        break
      }
      const when = simplifyOwnResponseConditionGroup(
        transition.when,
        unavailableQuestionIds,
        lockedAnswers,
      )
      if (when === false) continue
      if (when === true) {
        transitions.push({ ...transition, when: null })
        break
      }
      transitions.push({ ...transition, when })
    }
  }

  return {
    ...version,
    sections: version.sections.map((section) => ({
      ...section,
      questionIds: section.questionIds.filter((questionId) => !hiddenByVisibility.has(questionId)),
    })),
    questions,
    transitions,
  }
}

const retainedFileHandle = (
  secret: string,
  input: {
    locator: string
    submissionId: string
    actorUserId: string
    versionId: string
    questionId: string
    fileId: string
  },
): string => {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('FORM_TOKEN_SECRET_INVALID')
  return `rf_${createHmac('sha256', secret)
    .update(
      [
        input.locator,
        input.submissionId,
        input.actorUserId,
        input.versionId,
        input.questionId,
        input.fileId,
      ].join('\u0000'),
    )
    .digest('base64url')}`
}

const OWN_UPLOAD_TOKEN_PREFIX = 'oru_'
const BASE64URL_TOKEN_PART = /^[A-Za-z0-9_-]+$/u

export interface OwnResponseUploadBinding {
  formId: string
  versionId: string
  questionId: string
  submissionId: string
  actorUserId: string
}

const ownUploadSignature = (
  secret: string,
  randomPart: string,
  binding: OwnResponseUploadBinding,
): Buffer => {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('FORM_TOKEN_SECRET_INVALID')
  return createHmac('sha256', secret)
    .update(
      [
        'form-own-upload-v1',
        randomPart,
        binding.formId,
        binding.versionId,
        binding.questionId,
        binding.submissionId,
        binding.actorUserId,
      ].join('\u0000'),
    )
    .digest()
}

/** Bind a random bearer secret to exactly one owned response and question. */
export function bindOwnResponseUploadToken(
  randomPart: string,
  secret: string,
  binding: OwnResponseUploadBinding,
): string {
  if (!BASE64URL_TOKEN_PART.test(randomPart)) throw new Error('FORM_UPLOAD_TOKEN_INVALID')
  const signature = ownUploadSignature(secret, randomPart, binding).toString('base64url')
  return `${OWN_UPLOAD_TOKEN_PREFIX}${randomPart}.${signature}`
}

export function verifyOwnResponseUploadToken(
  token: string,
  secret: string,
  binding: OwnResponseUploadBinding,
): boolean {
  if (!token.startsWith(OWN_UPLOAD_TOKEN_PREFIX)) return false
  const [randomPart, encodedSignature, extra] = token
    .slice(OWN_UPLOAD_TOKEN_PREFIX.length)
    .split('.')
  if (
    !randomPart ||
    !encodedSignature ||
    extra !== undefined ||
    !BASE64URL_TOKEN_PART.test(randomPart) ||
    !BASE64URL_TOKEN_PART.test(encodedSignature)
  ) {
    return false
  }
  const received = Buffer.from(encodedSignature, 'base64url')
  if (received.toString('base64url') !== encodedSignature) return false
  const expected = ownUploadSignature(secret, randomPart, binding)
  return received.length === expected.length && timingSafeEqual(received, expected)
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
  const messages = Object.hasOwn(errors, questionId) ? errors[questionId] : undefined
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
  private readonly ownResponseSecret: () => string

  constructor(
    formRepo: FormRepositoryContract,
    databaseRepo: DatabaseRepository,
    pageRepo: ItemPageCreator,
    uow: UnitOfWork,
    formAccess: FormAccessResolver,
    now: () => Date = () => new Date(),
    ownResponseSecret: () => string = () => process.env.FORM_TOKEN_SECRET ?? '',
  ) {
    this.formRepo = formRepo
    this.databaseRepo = databaseRepo
    this.pageRepo = pageRepo
    this.uow = uow
    this.formAccess = formAccess
    this.now = now
    this.ownResponseSecret = ownResponseSecret
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

  async getOwnResponse(actorUserId: string, input: OwnResponseInput): Promise<OwnResponseDto> {
    const resolved = await this.formAccess.resolveOwnResponse(
      input.locator,
      input.submissionId,
      actorUserId,
    )
    if (resolved.status === 'UNAVAILABLE') throw ownResponseUnavailable()
    return this.toOwnResponseDto(resolved)
  }

  async updateOwnResponse(
    actorUserId: string,
    input: UpdateOwnResponseInput,
  ): Promise<UpdateOwnResponseResult> {
    const initial = await this.requireEditableOwnResponse(actorUserId, input)
    const initialSnapshot = await this.ownResponseSnapshot(initial)
    if (initialSnapshot.dto.revision !== input.expectedRevision) {
      throw conflict('FORM_RESPONSE_CHANGED')
    }
    const initialPlan = await this.prepareOwnResponseUpdate(initial, input, initialSnapshot)
    if (initialPlan.clearQuestionIds.length > 0 && input.confirmClearUnreachable !== true) {
      return {
        status: 'CONFIRM_CLEAR_REQUIRED',
        questionIds: initialPlan.clearQuestionIds,
      }
    }

    const transactionResult = await this.uow.transaction(async () => {
      const locked = await this.formRepo.lockOwnResponseContext({
        formId: initial.form.id,
        submissionId: initial.submission.id,
        rowId: initial.submission.rowId,
        sourceId: initial.form.sourceId,
        workspaceId: initial.form.source.workspaceId,
        sourcePageId: initial.form.source.pageId,
        responsePageId: initial.submission.row.pageId,
        respondentUserId: actorUserId,
        expectedUpdatedAt: initial.submission.row.updatedAt,
      })
      if (!locked) throw conflict('FORM_RESPONSE_CHANGED')

      const current = await this.requireEditableOwnResponse(actorUserId, input)
      if (
        current.submission.row.updatedAt.getTime() !== initial.submission.row.updatedAt.getTime()
      ) {
        throw conflict('FORM_RESPONSE_CHANGED')
      }
      const currentSnapshot = await this.ownResponseSnapshot(current)
      if (currentSnapshot.dto.revision !== input.expectedRevision) {
        throw conflict('FORM_RESPONSE_CHANGED')
      }
      const plan = await this.prepareOwnResponseUpdate(current, input, currentSnapshot)
      if (plan.clearQuestionIds.length > 0 && input.confirmClearUnreachable !== true) {
        return {
          status: 'CONFIRM_CLEAR_REQUIRED' as const,
          questionIds: plan.clearQuestionIds,
        }
      }

      const authoritiesLocked = await this.formRepo.lockFormSubmissionAuthorities({
        formId: current.form.id,
        workspaceId: current.form.source.workspaceId,
        formSourceId: current.form.sourceId,
        actorUserId,
        ...plan.prepared.authorities,
      })
      if (!authoritiesLocked) throw conflict('FORM_RESPONSE_CHANGED')

      // Rebuild everything consumed by writes after the authority rows are
      // frozen. This mirrors submit(): a target/property/upload that changed
      // between preflight and lock cannot ride a stale validation snapshot.
      const lockedCurrent = await this.requireEditableOwnResponse(actorUserId, input)
      const lockedSnapshot = await this.ownResponseSnapshot(lockedCurrent)
      if (lockedSnapshot.dto.revision !== input.expectedRevision) {
        throw conflict('FORM_RESPONSE_CHANGED')
      }
      const effective = await this.prepareOwnResponseUpdate(lockedCurrent, input, lockedSnapshot)
      if (!sameAuthorities(plan.prepared.authorities, effective.prepared.authorities)) {
        throw conflict('FORM_RESPONSE_CHANGED')
      }
      if (effective.clearQuestionIds.length > 0 && input.confirmClearUnreachable !== true) {
        return {
          status: 'CONFIRM_CLEAR_REQUIRED' as const,
          questionIds: effective.clearQuestionIds,
        }
      }

      await this.applyOwnResponseUpdate(lockedCurrent, input, effective)
      await this.formRepo.touchOwnResponseRow(current.submission.rowId, actorUserId)
      return { status: 'UPDATED' as const }
    })

    if (transactionResult.status === 'CONFIRM_CLEAR_REQUIRED') return transactionResult
    return { status: 'UPDATED' }
  }

  private async requireEditableOwnResponse(
    actorUserId: string,
    input: OwnResponseInput,
  ): Promise<Extract<OwnResponseResolution, { status: 'EDIT' }>> {
    const resolved = await this.formAccess.resolveOwnResponse(
      input.locator,
      input.submissionId,
      actorUserId,
    )
    if (resolved.status !== 'EDIT') throw ownResponseUnavailable()
    return resolved
  }

  private async ownResponseSnapshot(resolved: AccessibleOwnResponseResolution): Promise<{
    dto: OwnResponseDto
    unavailableQuestionIds: Set<string>
    retainedFilesByQuestion: Map<string, Map<string, string>>
    properties: Map<string, PropertyRow>
    lockedUnavailableAnswers: Record<string, unknown>
  }> {
    let document
    try {
      document = parseFormVersionDocument(resolved.version.schema)
    } catch {
      throw ownResponseUnavailable()
    }
    const publicVersion = toPublicFormVersion(document)
    const properties = new Map(
      (await this.databaseRepo.listProperties(resolved.form.sourceId)).map((property) => [
        property.id,
        property,
      ]),
    )
    const unavailableQuestionIds = new Set<string>()
    const cells = new Map(
      resolved.submission.row.cells.map(({ propertyId, value }) => [propertyId, value]),
    )
    const relations = new Map<string, string[]>()
    for (const link of resolved.submission.row.relationLinks) {
      const values = relations.get(link.propertyId)
      if (values === undefined) relations.set(link.propertyId, [link.targetRowId])
      else values.push(link.targetRowId)
    }
    const pageFiles = new Map(
      resolved.submission.row.page.files
        .filter(({ file }) => file.status === 'ACTIVE')
        .map((entry) => [entry.fileId, entry.file]),
    )
    const answers = Object.create(null) as Record<string, unknown>
    const files = Object.create(null) as Record<string, OwnResponseFile[]>
    const selectedOptions = Object.create(null) as Record<string, OwnResponseSelectedOption[]>
    const retainedFilesByQuestion = new Map<string, Map<string, string>>()
    const lockedUnavailableAnswers = Object.create(null) as Record<string, unknown>

    for (const question of document.questions) {
      if (question.property.kind === 'TITLE') {
        answers[question.id] = resolved.submission.row.page.title ?? ''
        continue
      }
      const property = properties.get(question.property.propertyId)
      if (property === undefined || property.type !== question.property.propertyType) {
        unavailableQuestionIds.add(question.id)
        const stored =
          question.property.propertyType === 'RELATION'
            ? relations.get(question.property.propertyId)
            : cells.get(question.property.propertyId)
        if (stored !== undefined) lockedUnavailableAnswers[question.id] = stored
        continue
      }
      if (question.property.propertyType === 'RELATION') {
        const rawIds = relations.get(property.id) ?? []
        const options = await this.resolveOwnResponseSelectedOptions(
          resolved,
          question,
          property,
          rawIds,
        )
        if (options.length !== new Set(rawIds).size) {
          unavailableQuestionIds.add(question.id)
          lockedUnavailableAnswers[question.id] = rawIds
          continue
        }
        selectedOptions[question.id] = options
        answers[question.id] = options.map(({ value }) => value)
        continue
      }
      if (question.property.propertyType === 'PERSON') {
        const raw = cells.get(property.id)
        const ids = typeof raw === 'string' ? [raw] : []
        const options = await this.resolveOwnResponseSelectedOptions(
          resolved,
          question,
          property,
          ids,
        )
        if (options.length !== new Set(ids).size) {
          unavailableQuestionIds.add(question.id)
          lockedUnavailableAnswers[question.id] = ids
          continue
        }
        selectedOptions[question.id] = options
        answers[question.id] = options.map(({ value }) => value)
        continue
      }
      if (question.property.propertyType === 'PAGE_LINK') {
        const raw = cells.get(property.id)
        const options = await this.resolveOwnResponseSelectedOptions(
          resolved,
          question,
          property,
          typeof raw === 'string' ? [raw] : [],
        )
        if (typeof raw === 'string' && options.length !== 1) {
          unavailableQuestionIds.add(question.id)
          lockedUnavailableAnswers[question.id] = raw
          continue
        }
        selectedOptions[question.id] = options
        answers[question.id] = options[0]?.value ?? ''
        continue
      }
      if (question.property.propertyType === 'FILE') {
        const raw = cells.get(property.id)
        const fileIds = Array.isArray(raw)
          ? raw.filter((value): value is string => typeof value === 'string')
          : []
        const retained = new Map<string, string>()
        const descriptors = fileIds.flatMap((fileId) => {
          const file = pageFiles.get(fileId)
          if (file === undefined) return []
          const handle = retainedFileHandle(this.ownResponseSecret(), {
            locator: resolved.locator,
            submissionId: resolved.submission.id,
            actorUserId: resolved.respondentUserId,
            versionId: resolved.version.id,
            questionId: question.id,
            fileId,
          })
          retained.set(handle, fileId)
          return [
            {
              handle,
              name: file.name,
              mimeType: file.mimeType,
              size: Number(file.fileSize),
            },
          ]
        })
        retainedFilesByQuestion.set(question.id, retained)
        files[question.id] = descriptors
        answers[question.id] = descriptors.map(({ handle }) => handle)
        continue
      }
      answers[question.id] = cells.get(property.id) ?? null
    }

    const safePublicVersion = sanitizeOwnResponseVersion(
      publicVersion,
      unavailableQuestionIds,
      lockedUnavailableAnswers,
    )

    const revision = createHash('sha256')
      .update(
        canonicalJson({
          title: resolved.submission.row.page.title,
          cells: [...resolved.submission.row.cells].sort((left, right) =>
            left.propertyId.localeCompare(right.propertyId),
          ),
          relations: [...resolved.submission.row.relationLinks].sort((left, right) =>
            `${left.propertyId}:${left.targetRowId}`.localeCompare(
              `${right.propertyId}:${right.targetRowId}`,
            ),
          ),
          files: [...resolved.submission.row.page.files]
            .map(({ fileId, file }) => ({ fileId, ...file }))
            .sort((left, right) => left.fileId.localeCompare(right.fileId)),
          properties: document.questions.map((question) => ({
            questionId: question.id,
            available: !unavailableQuestionIds.has(question.id),
          })),
        }),
      )
      .digest('hex')

    return {
      unavailableQuestionIds,
      retainedFilesByQuestion,
      properties,
      lockedUnavailableAnswers,
      dto: {
        status: resolved.status,
        revision,
        versionNumber: resolved.version.versionNumber,
        versionFingerprint: resolved.version.schemaHash,
        version: {
          ...safePublicVersion,
          questions: safePublicVersion.questions.map((question) => ({
            ...question,
            available: !unavailableQuestionIds.has(question.id),
          })),
        },
        answers,
        files,
        selectedOptions,
      },
    }
  }

  private async toOwnResponseDto(
    resolved: AccessibleOwnResponseResolution,
  ): Promise<OwnResponseDto> {
    return (await this.ownResponseSnapshot(resolved)).dto
  }

  private async resolveOwnResponseSelectedOptions(
    resolved: AccessibleOwnResponseResolution,
    question: FormQuestion,
    property: PropertyRow,
    rawIds: readonly string[],
  ): Promise<OwnResponseSelectedOption[]> {
    if (question.property.kind !== 'PROPERTY' || rawIds.length === 0) return []
    const kind = question.property.propertyType
    if (kind !== 'PERSON' && kind !== 'RELATION' && kind !== 'PAGE_LINK') return []
    const workspaceId = resolved.form.source.workspaceId
    let labels = new Map<string, string>()
    let accessibleIds = new Set<string>()

    if (kind === 'PERSON') {
      if (!(await this.databaseRepo.isWorkspaceMember(resolved.respondentUserId, workspaceId))) {
        return []
      }
      accessibleIds = await this.databaseRepo.findActiveWorkspaceMemberIds([...rawIds], workspaceId)
      labels = await this.databaseRepo.findUserNames([...accessibleIds])
    } else if (kind === 'PAGE_LINK') {
      accessibleIds = await this.pageRepo.findAccessiblePageLinkIds(
        resolved.respondentUserId,
        workspaceId,
        rawIds,
      )
      labels = await this.databaseRepo.findPageLabelsByIds(workspaceId, [...accessibleIds])
    } else {
      const targetSourceId = relationTargetSourceId(property)
      if (targetSourceId === null) return []
      const targetSource = (await this.databaseRepo.findSourceMetasByIds([targetSourceId])).get(
        targetSourceId,
      )
      if (targetSource === undefined || targetSource.workspaceId !== workspaceId) return []
      const rows = await this.databaseRepo.findRowsAccessMetaByIds([...rawIds])
      const rowsById = new Map(rows.map((row) => [row.id, row]))
      const candidateRows = rawIds.flatMap((rowId) => {
        const row = rowsById.get(rowId)
        return row !== undefined &&
          row.sourceId === targetSourceId &&
          row.workspaceId === workspaceId
          ? [row]
          : []
      })
      const accessiblePages = await this.pageRepo.findAccessiblePageIds(
        resolved.respondentUserId,
        workspaceId,
        [targetSource.pageId, ...candidateRows.map(({ pageId }) => pageId)],
      )
      if (!accessiblePages.has(targetSource.pageId)) return []
      const rules = toResolverRules(
        (await this.databaseRepo.findEnabledAccessRulesForSources([targetSourceId])).get(
          targetSourceId,
        ) ?? [],
      )
      const workspaceRole = await this.databaseRepo.findWorkspaceRole(
        resolved.respondentUserId,
        workspaceId,
      )
      const creatorPages = await this.databaseRepo.findSourcePageIdsCreatedBy(
        [targetSource.pageId],
        resolved.respondentUserId,
      )
      const shares = await this.databaseRepo.findItemPageShareLevels(
        candidateRows.map(({ pageId }) => pageId),
        resolved.respondentUserId,
      )
      for (const row of candidateRows) {
        if (!accessiblePages.has(row.pageId)) continue
        if (
          canViewRow(
            resolveRowAccess(
              {
                viewerId: resolved.respondentUserId,
                workspaceRole,
                isSourcePageCreator: creatorPages.has(targetSource.pageId),
                pageShareLevel: shares.get(row.pageId) ?? null,
              },
              rules,
              { rowCreatedById: row.createdById, cellsByProperty: row.cellsByProperty },
            ),
          )
        ) {
          accessibleIds.add(row.id)
        }
      }
      const rowsWithLabels = await this.databaseRepo.findRowsByIds([...accessibleIds])
      labels = new Map(rowsWithLabels.map(({ id, title }) => [id, title?.trim() || 'Без названия']))
    }

    return rawIds.flatMap((targetId) => {
      const label = labels.get(targetId)
      if (!accessibleIds.has(targetId) || label === undefined) return []
      return [
        {
          value: sealOwnResponseSelection(targetId, this.ownResponseSecret(), {
            locator: resolved.locator,
            submissionId: resolved.submission.id,
            actorUserId: resolved.respondentUserId,
            versionId: resolved.version.id,
            questionId: question.id,
            kind: kind as OwnResponseSelectionKind,
          }),
          label,
        },
      ]
    })
  }

  private async prepareOwnResponseUpdate(
    resolved: Extract<OwnResponseResolution, { status: 'EDIT' }>,
    input: UpdateOwnResponseInput,
    snapshot?: Awaited<ReturnType<FormSubmissionService['ownResponseSnapshot']>>,
  ): Promise<{
    prepared: PreparedFormSubmission
    document: ReturnType<typeof parseFormVersionDocument>
    current: Awaited<ReturnType<FormSubmissionService['ownResponseSnapshot']>>
    clearQuestionIds: string[]
  }> {
    const current = snapshot ?? (await this.ownResponseSnapshot(resolved))
    const unavailableFieldErrors = Object.fromEntries(
      [...current.unavailableQuestionIds]
        .filter((questionId) => Object.hasOwn(input.answers, questionId))
        .map((questionId) => [questionId, ['FORM_FIELD_UNAVAILABLE']]),
    )
    if (Object.keys(unavailableFieldErrors).length > 0) {
      throw new FormValidationError(unavailableFieldErrors)
    }
    const document = parseFormVersionDocument(resolved.version.schema)
    const decodedAnswers = { ...input.answers }
    for (const question of document.questions) {
      if (
        question.property.kind !== 'PROPERTY' ||
        (question.property.propertyType !== 'PERSON' &&
          question.property.propertyType !== 'RELATION' &&
          question.property.propertyType !== 'PAGE_LINK') ||
        !Object.hasOwn(decodedAnswers, question.id)
      ) {
        continue
      }
      const context = {
        locator: resolved.locator,
        submissionId: resolved.submission.id,
        actorUserId: resolved.respondentUserId,
        versionId: resolved.version.id,
        questionId: question.id,
        kind: question.property.propertyType,
      } as const
      const value = decodedAnswers[question.id]
      if (question.property.propertyType === 'PAGE_LINK') {
        if (value === '') continue
        const targetId =
          typeof value === 'string'
            ? openOwnResponseSelection(value, this.ownResponseSecret(), context)
            : null
        if (targetId === null) throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        decodedAnswers[question.id] = targetId
        continue
      }
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
      }
      const targetIds = value.map((token) =>
        openOwnResponseSelection(token, this.ownResponseSecret(), context),
      )
      if (targetIds.some((targetId) => targetId === null)) {
        throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
      }
      decodedAnswers[question.id] = targetIds as string[]
    }
    const prepared = await this.prepareSubmission(
      {
        resolved: {
          status: 'OPEN',
          locator: resolved.locator,
          form: resolved.form,
          version: resolved.version,
          respondentUserId: resolved.respondentUserId,
        },
        version: resolved.version,
        acceptedAt: this.now(),
      },
      {
        locator: input.locator,
        idempotencyKey: resolved.submission.id,
        answers: decodedAnswers,
      },
      {
        unavailableQuestionIds: current.unavailableQuestionIds,
        retainedFilesByQuestion: current.retainedFilesByQuestion,
        lockedAnswers: current.lockedUnavailableAnswers,
        ownUploadBinding: {
          formId: resolved.form.id,
          versionId: resolved.version.id,
          submissionId: resolved.submission.id,
          actorUserId: resolved.respondentUserId,
        },
      },
    )
    const editableRelationPropertyIds = new Set(
      document.questions.flatMap((question) =>
        question.property.kind === 'PROPERTY' &&
        question.property.propertyType === 'RELATION' &&
        !current.unavailableQuestionIds.has(question.id)
          ? [question.property.propertyId]
          : [],
      ),
    )
    const oldRelationTargetIds = sortedUnique(
      resolved.submission.row.relationLinks.flatMap(({ propertyId, targetRowId }) =>
        editableRelationPropertyIds.has(propertyId) ? [targetRowId] : [],
      ),
    )
    if (oldRelationTargetIds.length > 0) {
      const oldRows = await this.databaseRepo.findRowsAccessMetaByIds(oldRelationTargetIds)
      const oldRowIds = new Set(oldRows.map(({ id }) => id))
      if (
        oldRows.length !== oldRelationTargetIds.length ||
        oldRelationTargetIds.some((rowId) => !oldRowIds.has(rowId)) ||
        oldRows.some(({ workspaceId }) => workspaceId !== resolved.form.source.workspaceId)
      ) {
        throw conflict('FORM_RESPONSE_CHANGED')
      }
      prepared.authorities = {
        ...prepared.authorities,
        rowIds: sortedUnique([...prepared.authorities.rowIds, ...oldRelationTargetIds]),
        pageIds: sortedUnique([
          ...prepared.authorities.pageIds,
          ...oldRows.map(({ pageId }) => pageId),
        ]),
        sourceIds: sortedUnique([
          ...prepared.authorities.sourceIds,
          ...oldRows.map(({ sourceId }) => sourceId),
        ]),
        propertyIds: sortedUnique([
          ...prepared.authorities.propertyIds,
          ...[...editableRelationPropertyIds],
          ...[...editableRelationPropertyIds].flatMap((propertyId) => {
            const property = current.properties.get(propertyId)
            const backPropertyId = property === undefined ? null : relationBackPropertyId(property)
            return backPropertyId === null ? [] : [backPropertyId]
          }),
        ]),
      }
    }
    const visible = new Set(prepared.visibleQuestionIds)
    const clearQuestionIds = document.questions.flatMap((question) => {
      if (
        question.property.kind !== 'PROPERTY' ||
        current.unavailableQuestionIds.has(question.id) ||
        visible.has(question.id) ||
        isEmptyAnswer(current.dto.answers[question.id])
      ) {
        return []
      }
      return [question.id]
    })
    return { prepared, document, current, clearQuestionIds }
  }

  private async applyOwnResponseUpdate(
    resolved: Extract<OwnResponseResolution, { status: 'EDIT' }>,
    input: UpdateOwnResponseInput,
    plan: Awaited<ReturnType<FormSubmissionService['prepareOwnResponseUpdate']>>,
  ): Promise<void> {
    const visible = new Set(plan.prepared.visibleQuestionIds)
    const scalar = new Map(plan.prepared.scalarValues.map((value) => [value.propertyId, value]))
    const relations = new Map(
      plan.prepared.relationValues.map((value) => [value.propertyId, value]),
    )
    const fileValues = new Map(plan.prepared.fileValues.map((value) => [value.propertyId, value]))

    for (const question of plan.document.questions) {
      if (plan.current.unavailableQuestionIds.has(question.id)) continue
      if (question.property.kind === 'TITLE') {
        if (visible.has(question.id) && Object.hasOwn(input.answers, question.id)) {
          const value = input.answers[question.id]
          await this.databaseRepo.updatePageTitle(
            resolved.submission.row.pageId,
            typeof value === 'string' && value.length > 0 ? value : null,
            resolved.respondentUserId,
          )
        }
        continue
      }

      const propertyId = question.property.propertyId
      if (!visible.has(question.id)) {
        if (question.property.propertyType === 'RELATION') {
          const property = plan.current.properties.get(propertyId)
          if (property === undefined) throw conflict('FORM_PROPERTY_INVALID')
          await this.replaceOwnResponseRelation(property, resolved.submission.rowId, [])
        } else if (question.property.propertyType === 'FILE') {
          const oldIds = [
            ...(plan.current.retainedFilesByQuestion.get(question.id)?.values() ?? []),
          ]
          await this.formRepo.detachPageFiles(resolved.submission.row.pageId, oldIds)
          await this.databaseRepo.upsertFileCellValue(resolved.submission.rowId, propertyId, [])
        } else {
          await this.databaseRepo.upsertCellValue(resolved.submission.rowId, propertyId, null)
        }
        continue
      }

      if (question.property.propertyType === 'RELATION') {
        const property = plan.current.properties.get(propertyId)
        if (property === undefined) throw conflict('FORM_PROPERTY_INVALID')
        await this.replaceOwnResponseRelation(property, resolved.submission.rowId, [
          ...(relations.get(propertyId)?.targetRowIds ?? []),
        ])
      } else if (question.property.propertyType === 'FILE') {
        if (!Object.hasOwn(input.answers, question.id)) continue
        const file = fileValues.get(propertyId)
        const retainedFileIds = [...(file?.retainedFileIds ?? [])]
        const uploads = [...(file?.uploads ?? [])]
        if (uploads.length > 0) {
          await this.formRepo.consumeUploadLeases({
            formId: resolved.form.id,
            versionId: resolved.version.id,
            questionId: question.id,
            workspaceId: resolved.form.source.workspaceId,
            uploads,
            pageId: resolved.submission.row.pageId,
            consumedAt: plan.prepared.submittedAt,
          })
        }
        const oldIds = [...(plan.current.retainedFilesByQuestion.get(question.id)?.values() ?? [])]
        const retainedSet = new Set(retainedFileIds)
        await this.formRepo.detachPageFiles(
          resolved.submission.row.pageId,
          oldIds.filter((fileId) => !retainedSet.has(fileId)),
        )
        await this.databaseRepo.upsertFileCellValue(resolved.submission.rowId, propertyId, [
          ...retainedFileIds,
          ...uploads.map(({ fileId }) => fileId),
        ])
      } else {
        await this.databaseRepo.upsertCellValue(
          resolved.submission.rowId,
          propertyId,
          scalar.get(propertyId)?.value ?? null,
        )
      }
    }
  }

  private async replaceOwnResponseRelation(
    property: PropertyRow,
    rowId: string,
    targetRowIds: string[],
  ): Promise<void> {
    const next = [...new Set(targetRowIds)]
    const backPropertyId = relationBackPropertyId(property)
    const previous = backPropertyId
      ? ((await this.databaseRepo.findRelationLinks(property.id, [rowId])).get(rowId) ?? [])
      : []
    await this.databaseRepo.replaceRelationLinks({
      propertyId: property.id,
      rowId,
      targetRowIds: next,
    })
    if (backPropertyId === null) return

    const previousSet = new Set(previous)
    const nextSet = new Set(next)
    const affected = [...new Set([...previous, ...next])]
    const mirrors = await this.databaseRepo.findRelationLinks(backPropertyId, affected)
    for (const targetRowId of affected) {
      if (previousSet.has(targetRowId) === nextSet.has(targetRowId)) continue
      const current = new Set(mirrors.get(targetRowId) ?? [])
      if (nextSet.has(targetRowId)) current.add(rowId)
      else current.delete(rowId)
      await this.databaseRepo.replaceRelationLinks({
        propertyId: backPropertyId,
        rowId: targetRowId,
        targetRowIds: [...current],
      })
    }
  }

  private async prepareSubmission(
    context: SubmissionContext,
    input: FormSubmissionInput,
    options: PrepareSubmissionOptions = {},
  ): Promise<PreparedFormSubmission> {
    const { resolved, version, acceptedAt } = context

    let document
    try {
      document = parseFormVersionDocument(version.schema)
    } catch {
      throw conflict('FORM_VERSION_STALE')
    }
    if (document.schemaVersion !== version.schemaVersion) throw conflict('FORM_VERSION_STALE')

    const unavailableQuestionIds = options.unavailableQuestionIds ?? new Set<string>()
    const publicVersion = toPublicFormVersion(document)
    const validationVersion = {
      ...publicVersion,
      questions: publicVersion.questions.map((question) =>
        unavailableQuestionIds.has(question.id) ? { ...question, required: false } : question,
      ),
    }
    const answersResult = buildFormAnswerSchema(validationVersion).safeParse({
      answers: { ...options.lockedAnswers, ...input.answers },
    })
    if (!answersResult.success) {
      const fieldErrors = Object.create(null) as Record<string, string[]>
      for (const issue of answersResult.error.issues) {
        const questionId = issue.path[0] === 'answers' ? issue.path[1] : undefined
        if (typeof questionId === 'string') addFieldError(fieldErrors, questionId, issue.message)
      }
      throw new FormValidationError(fieldErrors)
    }

    const path = evaluateFormPath(validationVersion, answersResult.data.answers)
    const visibleQuestionIds = new Set(path.visibleQuestionIds)
    const currentProperties = new Map(
      (await this.databaseRepo.listProperties(resolved.form.sourceId)).map((property) => [
        property.id,
        property,
      ]),
    )

    for (const question of document.questions) {
      if (unavailableQuestionIds.has(question.id)) continue
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
    const personPlans: { questionId: string; propertyId: string; userId: string }[] = []
    const pageLinkPlans: { questionId: string; propertyId: string; pageId: string }[] = []
    const relationPlans: {
      questionId: string
      propertyId: string
      targetSourceId: string
      targetRowIds: string[]
    }[] = []
    const filePlans: {
      questionId: string
      propertyId: string
      tokenHashes: string[]
      retainedFileIds: string[]
      input: Extract<FormQuestion['input'], { kind: 'FILE' }>
    }[] = []
    let title: string | undefined

    for (const question of document.questions) {
      if (unavailableQuestionIds.has(question.id)) continue
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
        scalarValues.push({ propertyId, value: value as DatabaseCellWriteValue })
      } else if (
        question.property.propertyType === 'PERSON' &&
        question.input.kind === 'PERSON' &&
        Array.isArray(value) &&
        value.length === 1 &&
        typeof value[0] === 'string'
      ) {
        personPlans.push({ questionId: question.id, propertyId, userId: value[0] })
      } else if (
        question.property.propertyType === 'PAGE_LINK' &&
        question.input.kind === 'PAGE_LINK' &&
        typeof value === 'string' &&
        resolved.respondentUserId !== null
      ) {
        pageLinkPlans.push({ questionId: question.id, propertyId, pageId: value })
      } else if (
        question.property.propertyType === 'RELATION' &&
        question.input.kind === 'RELATION' &&
        Array.isArray(value) &&
        value.every((target): target is string => typeof target === 'string') &&
        resolved.respondentUserId !== null
      ) {
        const targetSourceId = relationTargetSourceId(property)
        if (targetSourceId === null) throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
        relationPlans.push({
          questionId: question.id,
          propertyId,
          targetSourceId,
          targetRowIds: value,
        })
      } else if (
        question.property.propertyType === 'FILE' &&
        question.input.kind === 'FILE' &&
        Array.isArray(value) &&
        value.every((token): token is string => typeof token === 'string')
      ) {
        const retainedHandles = options.retainedFilesByQuestion?.get(question.id)
        const retainedFileIds: string[] = []
        const leaseTokens: string[] = []
        for (const token of value) {
          const retainedFileId = retainedHandles?.get(token)
          if (retainedFileId !== undefined) {
            retainedFileIds.push(retainedFileId)
            continue
          }
          if (options.ownUploadBinding === undefined) {
            if (token.startsWith(OWN_UPLOAD_TOKEN_PREFIX)) {
              throw semanticError(question.id, 'FORM_UPLOAD_INVALID')
            }
          } else if (
            !verifyOwnResponseUploadToken(token, this.ownResponseSecret(), {
              ...options.ownUploadBinding,
              questionId: question.id,
            })
          ) {
            throw semanticError(question.id, 'FORM_UPLOAD_INVALID')
          }
          leaseTokens.push(token)
        }
        filePlans.push({
          questionId: question.id,
          propertyId,
          tokenHashes: leaseTokens.map((token) => createHash('sha256').update(token).digest('hex')),
          retainedFileIds,
          input: question.input,
        })
      } else if (question.property.propertyType === 'FILE') {
        throw semanticError(question.id, 'FORM_UPLOAD_INVALID')
      } else if (
        question.property.propertyType === 'PERSON' ||
        question.property.propertyType === 'PAGE_LINK' ||
        question.property.propertyType === 'RELATION'
      ) {
        throw semanticError(question.id, 'FORM_TARGET_INACCESSIBLE')
      } else {
        throw badRequest('FORM_SEMANTIC_PREPARATION_UNSUPPORTED')
      }
    }

    const targetSourceIds = sortedUnique(relationPlans.map(({ targetSourceId }) => targetSourceId))
    const targetRowIds = sortedUnique(relationPlans.flatMap(({ targetRowIds }) => targetRowIds))
    const actorUserId = resolved.respondentUserId
    // A Prisma transaction owns one PostgreSQL connection. Keep each batch O(1)
    // while issuing service-level queries serially rather than explicitly
    // scheduling concurrent client.query() calls on the same tx handle.
    const activeMemberIds = await this.databaseRepo.findActiveWorkspaceMemberIds(
      personPlans.map(({ userId }) => userId),
      resolved.form.source.workspaceId,
    )
    const targetSources = await this.databaseRepo.findSourceMetasByIds(targetSourceIds)
    const rows = await this.databaseRepo.findRowsAccessMetaByIds(targetRowIds)
    const accessiblePageLinkIds =
      actorUserId === null
        ? new Set<string>()
        : await this.pageRepo.findAccessiblePageLinkIds(
            actorUserId,
            resolved.form.source.workspaceId,
            pageLinkPlans.map(({ pageId }) => pageId),
          )
    const uploads = await this.formRepo.resolveUploadLeasesBatch({
      formId: resolved.form.id,
      versionId: version.id,
      bindings: filePlans.map(({ questionId, tokenHashes }) => ({ questionId, tokenHashes })),
      now: acceptedAt,
    })
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    const relationPageIds = sortedUnique([
      ...[...targetSources.values()].map(({ pageId }) => pageId),
      ...rows.map(({ pageId }) => pageId),
    ])
    const accessibleRelationPageIds =
      actorUserId === null
        ? new Set<string>()
        : await this.pageRepo.findAccessiblePageIds(
            actorUserId,
            resolved.form.source.workspaceId,
            relationPageIds,
          )
    const rulesBySource = await this.databaseRepo.findEnabledAccessRulesForSources(targetSourceIds)
    const workspaceRole =
      actorUserId === null || relationPlans.length === 0
        ? null
        : await this.databaseRepo.findWorkspaceRole(actorUserId, resolved.form.source.workspaceId)
    const creatorPageIds =
      actorUserId === null
        ? new Set<string>()
        : await this.databaseRepo.findSourcePageIdsCreatedBy(
            [...targetSources.values()].map(({ pageId }) => pageId),
            actorUserId,
          )
    const shareLevels =
      actorUserId === null
        ? new Map()
        : await this.databaseRepo.findItemPageShareLevels(
            rows.map(({ pageId }) => pageId),
            actorUserId,
          )
    const selectedPageIds = sortedUnique([
      resolved.form.source.pageId,
      ...pageLinkPlans.map(({ pageId }) => pageId),
      ...relationPageIds,
    ])
    const pageAuthorityMetadata = await this.pageRepo.findSubmissionAuthorityPageMetadata(
      resolved.form.source.workspaceId,
      selectedPageIds,
    )
    if (selectedPageIds.some((pageId) => !pageAuthorityMetadata.has(pageId))) {
      throw conflict('FORM_NOT_ACCEPTING')
    }

    for (const plan of personPlans) {
      if (!activeMemberIds.has(plan.userId)) {
        throw semanticError(plan.questionId, 'FORM_TARGET_INACCESSIBLE')
      }
      scalarValues.push({ propertyId: plan.propertyId, value: plan.userId })
    }
    for (const plan of pageLinkPlans) {
      if (!accessiblePageLinkIds.has(plan.pageId)) {
        throw semanticError(plan.questionId, 'FORM_TARGET_INACCESSIBLE')
      }
      scalarValues.push({ propertyId: plan.propertyId, value: plan.pageId })
    }
    for (const plan of relationPlans) {
      const targetSource = targetSources.get(plan.targetSourceId)
      if (
        actorUserId === null ||
        targetSource === undefined ||
        targetSource.workspaceId !== resolved.form.source.workspaceId
      ) {
        throw semanticError(plan.questionId, 'FORM_TARGET_INACCESSIBLE')
      }
      const targetPages = [
        targetSource.pageId,
        ...plan.targetRowIds.map((rowId) => rowsById.get(rowId)?.pageId ?? ''),
      ]
      if (
        plan.targetRowIds.some((rowId) => {
          const row = rowsById.get(rowId)
          return (
            row === undefined ||
            row.sourceId !== plan.targetSourceId ||
            row.workspaceId !== resolved.form.source.workspaceId
          )
        }) ||
        targetPages.some((pageId) => !accessibleRelationPageIds.has(pageId))
      ) {
        throw semanticError(plan.questionId, 'FORM_TARGET_INACCESSIBLE')
      }
      const rules = toResolverRules(rulesBySource.get(plan.targetSourceId) ?? [])
      for (const targetRowId of plan.targetRowIds) {
        const row = rowsById.get(targetRowId)!
        const accessContext: RowAccessContext = {
          viewerId: actorUserId,
          workspaceRole,
          isSourcePageCreator: creatorPageIds.has(targetSource.pageId),
          pageShareLevel: shareLevels.get(row.pageId) ?? null,
        }
        if (
          !canViewRow(
            resolveRowAccess(accessContext, rules, {
              rowCreatedById: row.createdById,
              cellsByProperty: row.cellsByProperty,
            }),
          )
        ) {
          throw semanticError(plan.questionId, 'FORM_TARGET_INACCESSIBLE')
        }
      }
      relationValues.push({ propertyId: plan.propertyId, targetRowIds: plan.targetRowIds })
    }

    const uploadsByBinding = new Map(
      uploads.map((upload) => [`${upload.questionId}:${upload.uploadTokenHash}`, upload]),
    )
    for (const plan of filePlans) {
      const ordered = plan.tokenHashes.map((hash) =>
        uploadsByBinding.get(`${plan.questionId}:${hash}`),
      )
      if (
        plan.retainedFileIds.length + ordered.length > plan.input.maxFiles ||
        ordered.some((upload) => upload === undefined) ||
        ordered.some(
          (upload) =>
            upload!.formId !== resolved.form.id ||
            upload!.versionId !== version.id ||
            upload!.questionId !== plan.questionId ||
            upload!.expiresAt.getTime() <= acceptedAt.getTime() ||
            upload!.consumedAt !== null ||
            upload!.file.workspaceId !== resolved.form.source.workspaceId ||
            upload!.file.status !== 'PENDING' ||
            !plan.input.allowedMimeTypes.includes(upload!.file.mimeType) ||
            upload!.file.fileSize > BigInt(plan.input.maxBytesPerFile),
        )
      ) {
        throw semanticError(plan.questionId, 'FORM_UPLOAD_INVALID')
      }
      fileValues.push({
        propertyId: plan.propertyId,
        questionId: plan.questionId,
        retainedFileIds: plan.retainedFileIds,
        uploads: ordered as FormUploadLeaseRecord[],
      })
    }

    const authorities: SubmissionAuthoritySnapshot = {
      personUserIds: sortedUnique(personPlans.map(({ userId }) => userId)),
      collectionIds: sortedUnique(
        [...pageAuthorityMetadata.values()].flatMap(({ collectionId, parentCollectionId }) => [
          ...(collectionId === null ? [] : [collectionId]),
          ...(parentCollectionId === null ? [] : [parentCollectionId]),
        ]),
      ),
      parentPageIds: sortedUnique(
        [...pageAuthorityMetadata.values()].flatMap(({ parentId }) =>
          parentId === null ? [] : [parentId],
        ),
      ),
      sourceIds: sortedUnique([resolved.form.sourceId, ...targetSourceIds]),
      propertyIds: sortedUnique([
        ...currentProperties.keys(),
        ...[...rulesBySource.values()].flatMap((rules) =>
          rules.map(({ propertyId }) => propertyId),
        ),
      ]),
      rowIds: targetRowIds,
      pageIds: selectedPageIds,
      uploadIds: sortedUnique(uploads.map(({ id }) => id)),
      fileIds: sortedUnique(uploads.map(({ fileId }) => fileId)),
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
      authorities,
      submittedAt: acceptedAt,
      visibleQuestionIds: path.visibleQuestionIds,
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
          sourceId: prepared.sourceId,
          collectionIds: prepared.authorities.collectionIds,
          parentPageIds: prepared.authorities.parentPageIds,
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

        const authoritiesLocked = await this.formRepo.lockFormSubmissionAuthorities({
          formId: prepared.formId,
          workspaceId: prepared.workspaceId,
          formSourceId: prepared.sourceId,
          actorUserId,
          ...prepared.authorities,
        })
        if (!authoritiesLocked) throw conflict('FORM_NOT_ACCEPTING')

        // Everything consumed by writes is authoritatively rebuilt after the
        // workspace-first lock, using the transaction-bound repositories.
        const context = await this.resolveSubmissionContext(actorUserId, input, token)
        this.assertSameFormIdentity(prepared, context.resolved, context.version)
        const effective = await this.prepareSubmission(context, input)
        if (!sameAuthorities(prepared.authorities, effective.authorities)) {
          throw conflict('FORM_NOT_ACCEPTING')
        }

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
          await this.databaseRepo.upsertFileCellValue(row.id, file.propertyId, [
            ...file.retainedFileIds,
            ...file.uploads.map(({ fileId }) => fileId),
          ])
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
