import type {
  DatabaseFormAudience,
  DatabaseFormRespondentAccess,
  DatabaseFormState,
  Prisma,
} from '@repo/db'

import { conflict } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import { parseFormVersionDocument } from './form-document.ts'

const versionSelect = {
  id: true,
  formId: true,
  versionNumber: true,
  schemaVersion: true,
  schema: true,
  schemaHash: true,
  publishedById: true,
  publishedAt: true,
  acceptUntil: true,
} as const satisfies Prisma.DatabaseFormVersionSelect

const managedFormSelect = {
  id: true,
  sourceId: true,
  viewId: true,
  routeKey: true,
  customSlug: true,
  linkRevision: true,
  state: true,
  audience: true,
  respondentAccess: true,
  draftSchema: true,
  draftRevision: true,
  publishedVersionId: true,
  opensAt: true,
  closesAt: true,
  responseLimit: true,
  acceptedResponses: true,
  notifyOwners: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  source: {
    select: {
      id: true,
      workspaceId: true,
      pageId: true,
      structureLocked: true,
      page: {
        select: {
          id: true,
          createdById: true,
          archivedAt: true,
          deletedAt: true,
        },
      },
      workspace: {
        select: {
          id: true,
          securityPolicy: { select: { disablePublicLinksSitesForms: true } },
        },
      },
      properties: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          type: true,
          name: true,
          position: true,
          settings: true,
        },
      },
    },
  },
  view: { select: { id: true, title: true, position: true } },
  createdBy: { select: { id: true, name: true } },
  publishedVersion: { select: versionSelect },
} as const satisfies Prisma.DatabaseFormSelect

const publicFormScalarSelect = {
  id: true,
  sourceId: true,
  routeKey: true,
  customSlug: true,
  linkRevision: true,
  state: true,
  audience: true,
  respondentAccess: true,
  publishedVersionId: true,
  opensAt: true,
  closesAt: true,
  responseLimit: true,
  acceptedResponses: true,
  createdById: true,
} as const

const responseSelect = {
  id: true,
  formId: true,
  versionId: true,
  rowId: true,
  respondentUserId: true,
  endingId: true,
  idempotencyKey: true,
  submittedAt: true,
  row: {
    select: {
      id: true,
      pageId: true,
      page: { select: { title: true, icon: true } },
      cells: { select: { propertyId: true, value: true } },
    },
  },
} as const satisfies Prisma.DatabaseFormSubmissionSelect

const submissionProvenanceSelect = {
  id: true,
  formId: true,
  versionId: true,
  rowId: true,
  respondentUserId: true,
  endingId: true,
  idempotencyKey: true,
  submittedAt: true,
} as const satisfies Prisma.DatabaseFormSubmissionSelect

export type ManagedFormRecord = Prisma.DatabaseFormGetPayload<{
  select: typeof managedFormSelect
}>

export type FormVersionRecord = Prisma.DatabaseFormVersionGetPayload<{
  select: typeof versionSelect
}>

export type FormResponseRecord = Prisma.DatabaseFormSubmissionGetPayload<{
  select: typeof responseSelect
}>

export type FormSubmissionRecord = Prisma.DatabaseFormSubmissionGetPayload<{
  select: typeof submissionProvenanceSelect
}>

export interface PublicFormRecord {
  id: string
  sourceId: string
  routeKey: string
  customSlug: string | null
  linkRevision: number
  state: DatabaseFormState
  audience: DatabaseFormAudience
  respondentAccess: DatabaseFormRespondentAccess
  publishedVersionId: string | null
  opensAt: Date | null
  closesAt: Date | null
  responseLimit: number | null
  acceptedResponses: number
  createdById: string
  source: {
    workspaceId: string
    pageId: string
    page: { archivedAt: Date | null; deletedAt: Date | null }
    workspace: {
      id: string
      securityPolicy: { disablePublicLinksSitesForms: boolean } | null
    }
  }
  publishedVersion: FormVersionRecord | null
  versions: FormVersionRecord[]
}

export interface CreateFormRecord {
  sourceId: string
  title: string
  position: number
  routeKey: string
  draftSchema: Prisma.InputJsonValue
  createdById: string
  viewSettings?: Prisma.InputJsonValue
}

export interface UpdateFormDraftRecord {
  formId: string
  expectedRevision: number
  draftSchema: Prisma.InputJsonValue
}

export interface PublishFormVersionRecord {
  formId: string
  previousPublishedVersionId: string | null
  previousAcceptUntil: Date | null
  versionNumber: number
  schemaVersion: number
  schema: Prisma.InputJsonValue
  schemaHash: string
  publishedById: string
  publishedAt: Date
  expectedState: Exclude<DatabaseFormState, 'ARCHIVED'>
  expectedDraftRevision: number
  expectedUpdatedAt: Date
  expectedLinkRevision: number
  state: Extract<DatabaseFormState, 'OPEN' | 'CLOSED'>
}

export interface UpdateFormSettingsRecord {
  formId: string
  expectedState: DatabaseFormState
  expectedUpdatedAt: Date
  expectedLinkRevision: number
  expectedDraftRevision: number
  expectedPublishedVersionId: string | null
  state?: DatabaseFormState
  audience?: DatabaseFormAudience
  respondentAccess?: DatabaseFormRespondentAccess
  opensAt?: Date | null
  closesAt?: Date | null
  responseLimit?: number | null
  notifyOwners?: boolean
  customSlug?: string | null
  routeKey?: string
  linkRevision?: number
}

export interface DuplicateFormRecord {
  sourceId: string
  title: string
  position: number
  routeKey: string
  draftSchema: Prisma.InputJsonValue
  createdById: string
  audience: DatabaseFormAudience
  respondentAccess: DatabaseFormRespondentAccess
  opensAt: Date | null
  closesAt: Date | null
  responseLimit: number | null
  notifyOwners: boolean
  viewSettings?: Prisma.InputJsonValue
}

export interface ArchiveFormRecord {
  formId: string
}

export interface ListFormResponsesRecord {
  formId: string
  cursor?: FormResponseCursor
  limit: number
}

export interface FormResponseCursor {
  submittedAt: Date
  id: string
}

export interface FormResponsePage {
  items: FormResponseRecord[]
  nextCursor: FormResponseCursor | null
}

export interface FormRepositoryContract {
  createFormWithView(input: CreateFormRecord): Promise<ManagedFormRecord>
  findManagedForm(pageId: string, formId: string): Promise<ManagedFormRecord | null>
  listManagedForms(pageId: string): Promise<ManagedFormRecord[]>
  updateDraftIfRevision(input: UpdateFormDraftRecord): Promise<ManagedFormRecord | null>
  publishVersion(input: PublishFormVersionRecord): Promise<ManagedFormRecord>
  updateSettings(input: UpdateFormSettingsRecord): Promise<ManagedFormRecord>
  duplicateForm(input: DuplicateFormRecord): Promise<ManagedFormRecord>
  archiveForm(input: ArchiveFormRecord): Promise<void>
  listVersions(formId: string, acceptedAt?: Date): Promise<FormVersionRecord[]>
  listResponses(input: ListFormResponsesRecord): Promise<FormResponsePage>
  findByLocator(locator: string): Promise<PublicFormRecord | null>
  findVersion(formId: string, versionNumber: number): Promise<FormVersionRecord | null>
  findSubmission(submissionId: string): Promise<FormSubmissionRecord | null>
  findSubmissionByIdempotency(formId: string, key: string): Promise<FormSubmissionRecord | null>
  hasProtectedPropertyDependency(
    propertyId: string,
    now: Date,
    removedOptionIds?: readonly string[],
  ): Promise<boolean>
}

export class DatabaseFormRepository implements FormRepositoryContract {
  private readonly uow: UnitOfWork

  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  async createFormWithView(input: CreateFormRecord): Promise<ManagedFormRecord> {
    const client = this.uow.client()
    const view = await client.databaseView.create({
      data: {
        sourceId: input.sourceId,
        type: 'FORM',
        title: input.title,
        position: input.position,
        settings: input.viewSettings,
      },
      select: { id: true },
    })
    return client.databaseForm.create({
      data: {
        sourceId: input.sourceId,
        viewId: view.id,
        routeKey: input.routeKey,
        draftSchema: input.draftSchema,
        createdById: input.createdById,
      },
      select: managedFormSelect,
    })
  }

  findManagedForm(pageId: string, formId: string): Promise<ManagedFormRecord | null> {
    return this.uow.client().databaseForm.findFirst({
      where: { id: formId, source: { pageId } },
      select: managedFormSelect,
    })
  }

  listManagedForms(pageId: string): Promise<ManagedFormRecord[]> {
    return this.uow.client().databaseForm.findMany({
      where: { source: { pageId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: managedFormSelect,
    })
  }

  async updateDraftIfRevision(input: UpdateFormDraftRecord): Promise<ManagedFormRecord | null> {
    const client = this.uow.client()
    const result = await client.databaseForm.updateMany({
      where: { id: input.formId, draftRevision: input.expectedRevision },
      data: { draftSchema: input.draftSchema, draftRevision: { increment: 1 } },
    })
    if (result.count === 0) return null
    return client.databaseForm.findUnique({
      where: { id: input.formId },
      select: managedFormSelect,
    })
  }

  async publishVersion(input: PublishFormVersionRecord): Promise<ManagedFormRecord> {
    const client = this.uow.client()
    // Task 6 must call this method inside UnitOfWork.transaction(). This
    // same-timestamp CAS acquires the form row lock for the remainder of that tx.
    const reserved = await client.databaseForm.updateMany({
      where: {
        id: input.formId,
        state: input.expectedState,
        draftRevision: input.expectedDraftRevision,
        updatedAt: input.expectedUpdatedAt,
        linkRevision: input.expectedLinkRevision,
        publishedVersionId: input.previousPublishedVersionId,
      },
      data: { updatedAt: input.expectedUpdatedAt },
    })
    if (reserved.count !== 1) throw conflict('FORM_PUBLISH_CONFLICT')

    if (input.previousPublishedVersionId !== null) {
      await client.databaseFormVersion.update({
        where: { id: input.previousPublishedVersionId, formId: input.formId },
        data: { acceptUntil: input.previousAcceptUntil },
        select: { id: true },
      })
    }
    const version = await client.databaseFormVersion.create({
      data: {
        formId: input.formId,
        versionNumber: input.versionNumber,
        schemaVersion: input.schemaVersion,
        schema: input.schema,
        schemaHash: input.schemaHash,
        publishedById: input.publishedById,
        publishedAt: input.publishedAt,
      },
      select: { id: true },
    })
    return client.databaseForm.update({
      where: { id: input.formId },
      data: { publishedVersionId: version.id, state: input.state },
      select: managedFormSelect,
    })
  }

  async updateSettings(input: UpdateFormSettingsRecord): Promise<ManagedFormRecord> {
    const client = this.uow.client()
    const {
      formId,
      expectedState,
      expectedUpdatedAt,
      expectedLinkRevision,
      expectedDraftRevision,
      expectedPublishedVersionId,
      ...data
    } = input
    const updated = await client.databaseForm.updateMany({
      where: {
        id: formId,
        state: expectedState,
        updatedAt: expectedUpdatedAt,
        linkRevision: expectedLinkRevision,
        draftRevision: expectedDraftRevision,
        publishedVersionId: expectedPublishedVersionId,
      },
      data,
    })
    if (updated.count !== 1) throw conflict('FORM_SETTINGS_CONFLICT')

    const form = await client.databaseForm.findUnique({
      where: { id: formId },
      select: managedFormSelect,
    })
    if (form === null) throw conflict('FORM_SETTINGS_CONFLICT')
    return form
  }

  async duplicateForm(input: DuplicateFormRecord): Promise<ManagedFormRecord> {
    const client = this.uow.client()
    const view = await client.databaseView.create({
      data: {
        sourceId: input.sourceId,
        type: 'FORM',
        title: input.title,
        position: input.position,
        settings: input.viewSettings,
      },
      select: { id: true },
    })
    return client.databaseForm.create({
      data: {
        sourceId: input.sourceId,
        viewId: view.id,
        routeKey: input.routeKey,
        draftSchema: input.draftSchema,
        createdById: input.createdById,
        audience: input.audience,
        respondentAccess: input.respondentAccess,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        responseLimit: input.responseLimit,
        notifyOwners: input.notifyOwners,
      },
      select: managedFormSelect,
    })
  }

  async archiveForm(input: ArchiveFormRecord): Promise<void> {
    const client = this.uow.client()
    const form = await client.databaseForm.findUnique({
      where: { id: input.formId },
      select: { viewId: true },
    })
    if (!form) return
    await client.databaseForm.update({
      where: { id: input.formId },
      data: { state: 'ARCHIVED', viewId: null },
      select: { id: true },
    })
    if (form.viewId !== null) {
      await client.databaseView.delete({ where: { id: form.viewId } })
    }
  }

  listVersions(formId: string, acceptedAt?: Date): Promise<FormVersionRecord[]> {
    return this.uow.client().databaseFormVersion.findMany({
      where: {
        formId,
        ...(acceptedAt
          ? {
              OR: [{ currentForForm: { isNot: null } }, { acceptUntil: { gt: acceptedAt } }],
            }
          : {}),
      },
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      select: versionSelect,
    })
  }

  async listResponses(input: ListFormResponsesRecord): Promise<FormResponsePage> {
    const records = await this.uow.client().databaseFormSubmission.findMany({
      where: {
        formId: input.formId,
        ...(input.cursor
          ? {
              OR: [
                { submittedAt: { lt: input.cursor.submittedAt } },
                { submittedAt: input.cursor.submittedAt, id: { lt: input.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      select: responseSelect,
    })
    const hasNext = records.length > input.limit
    const items = hasNext ? records.slice(0, input.limit) : records
    const last = items.at(-1)
    return {
      items,
      nextCursor: hasNext && last ? { submittedAt: last.submittedAt, id: last.id } : null,
    }
  }

  async findByLocator(locator: string): Promise<PublicFormRecord | null> {
    const now = new Date()
    return this.uow.client().databaseForm.findFirst({
      where: { OR: [{ routeKey: locator }, { customSlug: locator.toLowerCase() }] },
      select: {
        ...publicFormScalarSelect,
        source: {
          select: {
            workspaceId: true,
            pageId: true,
            page: { select: { archivedAt: true, deletedAt: true } },
            workspace: {
              select: {
                id: true,
                securityPolicy: { select: { disablePublicLinksSitesForms: true } },
              },
            },
          },
        },
        publishedVersion: { select: versionSelect },
        versions: {
          where: { acceptUntil: { gt: now } },
          orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
          take: 1,
          select: versionSelect,
        },
      },
    })
  }

  findVersion(formId: string, versionNumber: number): Promise<FormVersionRecord | null> {
    return this.uow.client().databaseFormVersion.findUnique({
      where: { formId_versionNumber: { formId, versionNumber } },
      select: versionSelect,
    })
  }

  findSubmission(submissionId: string): Promise<FormSubmissionRecord | null> {
    return this.uow.client().databaseFormSubmission.findUnique({
      where: { id: submissionId },
      select: submissionProvenanceSelect,
    })
  }

  findSubmissionByIdempotency(formId: string, key: string): Promise<FormSubmissionRecord | null> {
    return this.uow.client().databaseFormSubmission.findUnique({
      where: { formId_idempotencyKey: { formId, idempotencyKey: key } },
      select: submissionProvenanceSelect,
    })
  }

  async hasProtectedPropertyDependency(
    propertyId: string,
    now: Date,
    removedOptionIds?: readonly string[],
  ): Promise<boolean> {
    const versions = await this.uow.client().databaseFormVersion.findMany({
      where: {
        form: {
          state: { not: 'ARCHIVED' },
          source: { properties: { some: { id: propertyId } } },
        },
        OR: [{ currentForForm: { isNot: null } }, { acceptUntil: { gt: now } }],
      },
      select: { schema: true },
    })
    for (const version of versions) {
      try {
        const document = parseFormVersionDocument(version.schema)
        const question = document.questions.find(
          (candidate) =>
            candidate.property.kind === 'PROPERTY' && candidate.property.propertyId === propertyId,
        )
        if (question === undefined) continue
        if (removedOptionIds === undefined) return true
        if (
          (question.input.kind === 'SINGLE_CHOICE' ||
            question.input.kind === 'MULTI_CHOICE') &&
          question.input.options.some(({ id }) => removedOptionIds.includes(id))
        ) {
          return true
        }
      } catch {
        // Active malformed data is a migration/drift problem. Prevent a destructive
        // property edit until an owner can repair or republish the document.
        return true
      }
    }
    return false
  }
}
