import type {
  DatabaseCellWriteValue,
  DatabaseRepository,
} from '../repositories/database.repository.ts'
import type { ItemPageCreator } from '../../shared/item-page-creator.ts'
import { conflict } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { FormRepositoryContract, FormSubmissionRecord } from './database-form.repository.ts'

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

const ROW_POSITION_STEP = 1_024

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

  constructor(
    formRepo: FormRepositoryContract,
    databaseRepo: DatabaseRepository,
    pageRepo: ItemPageCreator,
    uow: UnitOfWork,
  ) {
    this.formRepo = formRepo
    this.databaseRepo = databaseRepo
    this.pageRepo = pageRepo
    this.uow = uow
  }

  persistPrepared(prepared: PreparedFormSubmission): Promise<FormSubmissionResult> {
    return this.uow.transaction(async () => {
      const replay = await this.formRepo.findSubmissionByIdempotency(
        prepared.formId,
        prepared.idempotencyKey,
      )
      if (replay !== null) return toSubmissionResult(replay, false)

      const reserved = await this.formRepo.reserveResponseSlot(
        prepared.formId,
        prepared.submittedAt,
      )
      if (!reserved) throw conflict('FORM_NOT_ACCEPTING')

      const itemPage = await this.pageRepo.createItemPageTx(
        prepared.sourcePageId,
        prepared.workspaceId,
        prepared.respondentUserId,
      )
      const maxPosition = await this.databaseRepo.maxRowPosition(prepared.sourceId)
      const row = await this.databaseRepo.createRow({
        sourceId: prepared.sourceId,
        pageId: itemPage.id,
        position: maxPosition + ROW_POSITION_STEP,
        createdById: prepared.respondentUserId,
      })
      await this.databaseRepo.updatePageTitle(
        itemPage.id,
        prepared.title,
        prepared.respondentUserId,
      )
      for (const scalar of prepared.scalarValues) {
        await this.databaseRepo.upsertCellValue(row.id, scalar.propertyId, scalar.value)
      }

      const submission = await this.formRepo.createSubmission({
        formId: prepared.formId,
        versionId: prepared.versionId,
        rowId: row.id,
        respondentUserId: prepared.respondentUserId,
        endingId: prepared.endingId,
        idempotencyKey: prepared.idempotencyKey,
        submittedAt: prepared.submittedAt,
      })
      await this.formRepo.enqueueFormSubmittedEvent({
        formId: prepared.formId,
        versionNumber: prepared.versionNumber,
        sourceId: prepared.sourceId,
        sourcePageId: prepared.sourcePageId,
        workspaceId: prepared.workspaceId,
        rowId: row.id,
        itemPageId: itemPage.id,
        submissionId: submission.id,
        respondentUserId: prepared.respondentUserId,
        submittedAt: prepared.submittedAt,
      })
      return toSubmissionResult(submission, true)
    })
  }
}
