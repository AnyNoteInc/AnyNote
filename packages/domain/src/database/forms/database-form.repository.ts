import {
  DatabaseFormAudience,
  DatabaseFormRespondentAccess,
  DatabaseFormState,
  Prisma,
  enqueueWebhookEvent,
} from '@repo/db'

import { conflict } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import { lockWorkspaceForMutation } from '../../shared/workspace-transaction-lock.ts'
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
  endingId: true,
  submittedAt: true,
  row: {
    select: {
      id: true,
      pageId: true,
      position: true,
      createdAt: true,
      createdById: true,
      updatedAt: true,
      updatedById: true,
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
  row: { select: { pageId: true } },
} as const satisfies Prisma.DatabaseFormSubmissionSelect

const formUploadLeaseSelect = {
  id: true,
  formId: true,
  versionId: true,
  questionId: true,
  fileId: true,
  uploadTokenHash: true,
  expiresAt: true,
  consumedAt: true,
  file: {
    select: {
      workspaceId: true,
      status: true,
      mimeType: true,
      fileSize: true,
    },
  },
} as const satisfies Prisma.DatabaseFormUploadSelect

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

export type FormUploadLeaseRecord = Prisma.DatabaseFormUploadGetPayload<{
  select: typeof formUploadLeaseSelect
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
  rowWhere?: Prisma.DatabaseRowWhereInput
}

export interface FormResponseCursor {
  submittedAt: Date
  id: string
}

export interface FormResponsePage {
  items: FormResponseRecord[]
  nextCursor: FormResponseCursor | null
}

export interface ListFormVersionsOptions {
  acceptedAt?: Date
  beforeVersionNumber?: number
  limit?: number
}

export interface CreateFormSubmissionRecord {
  formId: string
  versionId: string
  rowId: string
  respondentUserId: string | null
  endingId: string
  idempotencyKey: string
  submittedAt: Date
}

export interface EnqueueFormSubmittedEventRecord {
  formId: string
  versionNumber: number
  sourceId: string
  sourcePageId: string
  workspaceId: string
  rowId: string
  itemPageId: string
  submissionId: string
  respondentUserId: string | null
  submittedAt: Date
}

export interface LockFormSubmissionContextRecord {
  formId: string
  workspaceId: string
  pageId: string
  sourceId: string
  collectionIds: readonly string[]
  parentPageIds: readonly string[]
  actorUserId: string | null
}

export interface ReserveFormResponseSlotRecord {
  formId: string
  now: Date
  expectedLinkRevision: number
  expectedAudience: DatabaseFormAudience
}

export interface ResolveFormUploadLeasesRecord {
  formId: string
  versionId: string
  questionId: string
  tokenHashes: readonly string[]
  now: Date
}

export interface ResolveFormUploadLeasesBatchRecord {
  formId: string
  versionId: string
  bindings: readonly { questionId: string; tokenHashes: readonly string[] }[]
  now: Date
}

export interface LockFormSubmissionAuthoritiesRecord {
  formId: string
  workspaceId: string
  formSourceId: string
  actorUserId: string | null
  personUserIds: readonly string[]
  sourceIds: readonly string[]
  propertyIds: readonly string[]
  rowIds: readonly string[]
  collectionIds: readonly string[]
  parentPageIds: readonly string[]
  pageIds: readonly string[]
  uploadIds: readonly string[]
  fileIds: readonly string[]
}

export interface ConsumeFormUploadLeasesRecord {
  formId: string
  versionId: string
  questionId: string
  workspaceId: string
  uploads: readonly FormUploadLeaseRecord[]
  pageId: string
  consumedAt: Date
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
  listVersions(formId: string, options?: ListFormVersionsOptions): Promise<FormVersionRecord[]>
  listResponses(input: ListFormResponsesRecord): Promise<FormResponsePage>
  findByLocator(locator: string): Promise<PublicFormRecord | null>
  findVersion(formId: string, versionNumber: number): Promise<FormVersionRecord | null>
  findSubmission(submissionId: string): Promise<FormSubmissionRecord | null>
  findSubmissionByIdempotency(formId: string, key: string): Promise<FormSubmissionRecord | null>
  lockSubmissionContext(input: LockFormSubmissionContextRecord): Promise<boolean>
  lockFormSubmissionAuthorities(input: LockFormSubmissionAuthoritiesRecord): Promise<boolean>
  reserveResponseSlot(input: ReserveFormResponseSlotRecord): Promise<boolean>
  resolveUploadLeases(input: ResolveFormUploadLeasesRecord): Promise<FormUploadLeaseRecord[]>
  resolveUploadLeasesBatch(
    input: ResolveFormUploadLeasesBatchRecord,
  ): Promise<FormUploadLeaseRecord[]>
  consumeUploadLeases(input: ConsumeFormUploadLeasesRecord): Promise<void>
  createSubmission(input: CreateFormSubmissionRecord): Promise<FormSubmissionRecord>
  enqueueFormSubmittedEvent(input: EnqueueFormSubmittedEventRecord): Promise<void>
  hasProtectedPropertyDependency(
    propertyId: string,
    now: Date,
    removedOptionIds?: readonly string[],
  ): Promise<boolean>
}

function isPostgresLockUnavailable(error: unknown): boolean {
  const pending: unknown[] = [error]
  const seen = new WeakSet<object>()
  let inspected = 0
  while (pending.length > 0 && inspected < 16) {
    const value = pending.pop()
    if (value === null || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    inspected += 1
    const record = value as Record<string, unknown>
    if (record.code === '55P03' || record.originalCode === '55P03') return true
    pending.push(record.meta, record.cause, record.driverAdapterError)
  }
  return false
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
      await client.databaseView.updateMany({
        where: { id: form.viewId, archivedAt: null },
        data: { archivedAt: new Date() },
      })
    }
  }

  listVersions(
    formId: string,
    options: ListFormVersionsOptions = {},
  ): Promise<FormVersionRecord[]> {
    return this.uow.client().databaseFormVersion.findMany({
      where: {
        formId,
        ...(options.acceptedAt
          ? {
              OR: [
                { currentForForm: { isNot: null } },
                { acceptUntil: { gt: options.acceptedAt } },
              ],
            }
          : {}),
        ...(options.beforeVersionNumber === undefined
          ? {}
          : { versionNumber: { lt: options.beforeVersionNumber } }),
      },
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      take: options.limit,
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
        row: {
          is: {
            deletedAt: null,
            ...(input.rowWhere === undefined ? {} : { AND: [input.rowWhere] }),
          },
        },
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
    return this.uow.client().databaseForm.findFirst({
      where: { OR: [{ routeKey: locator }, { customSlug: locator }] },
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

  async lockSubmissionContext(input: LockFormSubmissionContextRecord): Promise<boolean> {
    try {
      return await this.lockSubmissionContextNowait(input)
    } catch (error) {
      if (isPostgresLockUnavailable(error)) return false
      throw error
    }
  }

  private async lockSubmissionContextNowait(
    input: LockFormSubmissionContextRecord,
  ): Promise<boolean> {
    const client = this.uow.client()
    const collectionIds = [...new Set(input.collectionIds)].sort()
    const parentPageIds = [...new Set(input.parentPageIds)].sort()
    const uuidList = (ids: readonly string[]) =>
      Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))
    // Parent-before-child is the canonical lock order. Locking the workspace
    // first also closes the lazy policy/membership insertion gap through FK
    // locking and blocks destructive workspace deletion until submission ends.
    if (!(await lockWorkspaceForMutation(client, input.workspaceId))) return false

    await client.$queryRaw<{ workspaceId: string }[]>(Prisma.sql`
      SELECT workspace_id AS "workspaceId"
      FROM workspace_security_policies
      WHERE workspace_id = ${input.workspaceId}::uuid
      FOR UPDATE NOWAIT
    `)

    if (input.actorUserId !== null) {
      await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id
        FROM workspace_members
        WHERE workspace_id = ${input.workspaceId}::uuid
          AND user_id = ${input.actorUserId}::uuid
        FOR UPDATE NOWAIT
      `)
    }

    if (collectionIds.length > 0) {
      const collections = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM collections
        WHERE id IN (${uuidList(collectionIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (collections.length !== collectionIds.length) return false
    }

    if (parentPageIds.length > 0) {
      const parentPages = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM pages
        WHERE id IN (${uuidList(parentPageIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (parentPages.length !== parentPageIds.length) return false
    }

    const pages = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id
      FROM pages
      WHERE id = ${input.pageId}::uuid
        AND workspace_id = ${input.workspaceId}::uuid
      FOR UPDATE NOWAIT
    `)
    if (pages.length !== 1) return false

    const sources = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id
      FROM database_sources
      WHERE id = ${input.sourceId}::uuid
        AND workspace_id = ${input.workspaceId}::uuid
        AND page_id = ${input.pageId}::uuid
      FOR UPDATE NOWAIT
    `)
    if (sources.length !== 1) return false

    const forms = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id
      FROM database_forms
      WHERE id = ${input.formId}::uuid
        AND source_id = ${input.sourceId}::uuid
      FOR UPDATE NOWAIT
    `)
    if (forms.length !== 1) return false
    return true
  }

  /**
   * Freeze every authority row selected by the preflight semantic snapshot.
   * The global order follows the Prisma FK graph, parent before child, rather
   * than any writer's current call sequence. Every UUID set is sorted before
   * locking. lockSubmissionContext already holds workspace -> collections ->
   * parent pages -> source page -> form source -> form, so repeated parent
   * locks below are idempotent and this continuation never acquires a child
   * before an unlocked parent.
   */
  async lockFormSubmissionAuthorities(
    input: LockFormSubmissionAuthoritiesRecord,
  ): Promise<boolean> {
    try {
      return await this.lockFormSubmissionAuthoritiesNowait(input)
    } catch (error) {
      if (isPostgresLockUnavailable(error)) return false
      throw error
    }
  }

  private async lockFormSubmissionAuthoritiesNowait(
    input: LockFormSubmissionAuthoritiesRecord,
  ): Promise<boolean> {
    const client = this.uow.client()
    const personUserIds = [...new Set(input.personUserIds)].sort()
    const sourceIds = [...new Set(input.sourceIds)].sort()
    const targetSourceIds = sourceIds.filter((id) => id !== input.formSourceId)
    const rowIds = [...new Set(input.rowIds)].sort()
    const collectionIds = [...new Set(input.collectionIds)].sort()
    const parentPageIds = [...new Set(input.parentPageIds)].sort()
    const parentPageIdSet = new Set(parentPageIds)
    const pageIds = [...new Set(input.pageIds)].sort()
    const remainingPageIds = pageIds.filter((id) => !parentPageIdSet.has(id))
    const fileIds = [...new Set(input.fileIds)].sort()
    const uploadIds = [...new Set(input.uploadIds)].sort()
    const uuidList = (ids: readonly string[]) =>
      Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))

    if (personUserIds.length > 0) {
      const members = await client.$queryRaw<{ user_id: string }[]>(Prisma.sql`
        SELECT user_id FROM workspace_members
        WHERE workspace_id = ${input.workspaceId}::uuid
          AND user_id IN (${uuidList(personUserIds)})
        ORDER BY user_id FOR UPDATE NOWAIT
      `)
      if (members.length !== personUserIds.length) return false
      await client.$queryRaw(Prisma.sql`
        SELECT user_id FROM workspace_blocked_users
        WHERE workspace_id = ${input.workspaceId}::uuid
          AND user_id IN (${uuidList(personUserIds)})
        ORDER BY user_id FOR UPDATE NOWAIT
      `)
    }

    if (collectionIds.length > 0) {
      const collections = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM collections
        WHERE id IN (${uuidList(collectionIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (collections.length !== collectionIds.length) return false
    }
    if (parentPageIds.length > 0) {
      const parentPages = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM pages
        WHERE id IN (${uuidList(parentPageIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (parentPages.length !== parentPageIds.length) return false
    }
    if (remainingPageIds.length > 0) {
      const pages = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM pages
        WHERE id IN (${uuidList(remainingPageIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (pages.length !== remainingPageIds.length) return false
    }

    if (targetSourceIds.length > 0) {
      const targetSources = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM database_sources
        WHERE id IN (${uuidList(targetSourceIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (targetSources.length !== targetSourceIds.length) return false
    }
    const properties = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM database_properties
      WHERE source_id IN (${uuidList(sourceIds)})
      ORDER BY id FOR UPDATE NOWAIT
    `)
    const lockedPropertyIds = new Set(properties.map(({ id }) => id))
    if (input.propertyIds.some((id) => !lockedPropertyIds.has(id))) return false
    if (sourceIds.length > 0) {
      await client.$queryRaw(Prisma.sql`
        SELECT id FROM database_page_access_rules
        WHERE source_id IN (${uuidList(sourceIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
    }
    if (rowIds.length > 0) {
      const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM database_rows
        WHERE id IN (${uuidList(rowIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (rows.length !== rowIds.length) return false
      await client.$queryRaw(Prisma.sql`
        SELECT id FROM database_cell_values
        WHERE row_id IN (${uuidList(rowIds)})
          AND property_id IN (
            SELECT property_id FROM database_page_access_rules
            WHERE source_id IN (${uuidList(sourceIds)})
          )
        ORDER BY id FOR UPDATE NOWAIT
      `)
    }
    if (pageIds.length > 0) {
      await client.$queryRaw(Prisma.sql`
        SELECT id FROM page_shares
        WHERE page_id IN (${uuidList(pageIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (input.actorUserId !== null) {
        await client.$queryRaw(Prisma.sql`
          SELECT id FROM page_share_users
          WHERE user_id = ${input.actorUserId}::uuid
            AND page_share_id IN (
              SELECT id FROM page_shares WHERE page_id IN (${uuidList(pageIds)})
            )
          ORDER BY id FOR UPDATE NOWAIT
        `)
      }
    }
    if (fileIds.length > 0) {
      const files = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM files
        WHERE id IN (${uuidList(fileIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (files.length !== fileIds.length) return false
    }
    if (uploadIds.length > 0) {
      const uploads = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM database_form_uploads
        WHERE id IN (${uuidList(uploadIds)})
        ORDER BY id FOR UPDATE NOWAIT
      `)
      if (uploads.length !== uploadIds.length) return false
    }
    return true
  }

  async reserveResponseSlot(input: ReserveFormResponseSlotRecord): Promise<boolean> {
    const reserved = await this.uow.client().$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE database_forms
      SET accepted_responses = accepted_responses + 1,
          updated_at = now()
      WHERE id = ${input.formId}::uuid
        AND state = ${DatabaseFormState.OPEN}::"DatabaseFormState"
        AND link_revision = ${input.expectedLinkRevision}
        AND audience = ${input.expectedAudience}::"DatabaseFormAudience"
        AND (opens_at IS NULL OR opens_at <= ${input.now})
        AND (closes_at IS NULL OR closes_at > ${input.now})
        AND (response_limit IS NULL OR accepted_responses < response_limit)
      RETURNING id
    `)
    return reserved.length === 1
  }

  resolveUploadLeases(input: ResolveFormUploadLeasesRecord): Promise<FormUploadLeaseRecord[]> {
    if (input.tokenHashes.length === 0) return Promise.resolve([])
    return this.uow.client().databaseFormUpload.findMany({
      where: {
        formId: input.formId,
        versionId: input.versionId,
        questionId: input.questionId,
        uploadTokenHash: { in: [...input.tokenHashes] },
        expiresAt: { gt: input.now },
        consumedAt: null,
        file: { is: { status: 'PENDING' } },
      },
      select: formUploadLeaseSelect,
    })
  }

  resolveUploadLeasesBatch(
    input: ResolveFormUploadLeasesBatchRecord,
  ): Promise<FormUploadLeaseRecord[]> {
    const questionIds = [...new Set(input.bindings.map(({ questionId }) => questionId))]
    const tokenHashes = [
      ...new Set(input.bindings.flatMap(({ tokenHashes: hashes }) => [...hashes])),
    ]
    if (questionIds.length === 0 || tokenHashes.length === 0) return Promise.resolve([])
    return this.uow.client().databaseFormUpload.findMany({
      where: {
        formId: input.formId,
        versionId: input.versionId,
        questionId: { in: questionIds },
        uploadTokenHash: { in: tokenHashes },
        expiresAt: { gt: input.now },
        consumedAt: null,
        file: { is: { status: 'PENDING' } },
      },
      select: formUploadLeaseSelect,
    })
  }

  async consumeUploadLeases(input: ConsumeFormUploadLeasesRecord): Promise<void> {
    const client = this.uow.client()
    for (const upload of input.uploads) {
      const claimed = await client.databaseFormUpload.updateMany({
        where: {
          id: upload.id,
          formId: input.formId,
          versionId: input.versionId,
          questionId: input.questionId,
          fileId: upload.fileId,
          expiresAt: { gt: input.consumedAt },
          consumedAt: null,
        },
        data: { consumedAt: input.consumedAt },
      })
      if (claimed.count !== 1) throw conflict('FORM_UPLOAD_INVALID')

      const activated = await client.file.updateMany({
        where: {
          id: upload.fileId,
          workspaceId: input.workspaceId,
          status: 'PENDING',
        },
        data: { status: 'ACTIVE', expiresAt: null },
      })
      if (activated.count !== 1) throw conflict('FORM_UPLOAD_INVALID')

      await client.pageFile.create({
        data: { pageId: input.pageId, fileId: upload.fileId },
      })
    }
  }

  createSubmission(input: CreateFormSubmissionRecord): Promise<FormSubmissionRecord> {
    return this.uow.client().databaseFormSubmission.create({
      data: input,
      select: submissionProvenanceSelect,
    })
  }

  async enqueueFormSubmittedEvent(input: EnqueueFormSubmittedEventRecord): Promise<void> {
    await enqueueWebhookEvent(this.uow.client() as Prisma.TransactionClient, {
      event: 'database.form.submitted',
      resourceType: 'page',
      resourceId: input.sourcePageId,
      workspaceId: input.workspaceId,
      actorId: input.respondentUserId,
      hints: {
        formId: input.formId,
        versionNumber: input.versionNumber,
        sourceId: input.sourceId,
        rowId: input.rowId,
        itemPageId: input.itemPageId,
        submissionId: input.submissionId,
        submittedAt: input.submittedAt.toISOString(),
        respondentKind: input.respondentUserId === null ? 'anonymous' : 'authenticated',
      },
    })
  }

  async hasProtectedPropertyDependency(
    propertyId: string,
    now: Date,
    removedOptionIds?: readonly string[],
  ): Promise<boolean> {
    const batchSize = 100
    let beforeId: string | undefined
    for (;;) {
      const versions = await this.uow.client().databaseFormVersion.findMany({
        where: {
          ...(beforeId === undefined ? {} : { id: { lt: beforeId } }),
          form: {
            state: { not: 'ARCHIVED' },
            source: { properties: { some: { id: propertyId } } },
          },
          OR: [{ currentForForm: { isNot: null } }, { acceptUntil: { gt: now } }],
        },
        orderBy: [{ id: 'desc' }],
        take: batchSize,
        select: { id: true, schema: true },
      })
      for (const version of versions) {
        try {
          const document = parseFormVersionDocument(version.schema)
          const question = document.questions.find(
            (candidate) =>
              candidate.property.kind === 'PROPERTY' &&
              candidate.property.propertyId === propertyId,
          )
          if (question === undefined) continue
          if (removedOptionIds === undefined) return true
          if (
            (question.input.kind === 'SINGLE_CHOICE' || question.input.kind === 'MULTI_CHOICE') &&
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
      if (versions.length < batchSize) return false
      const nextBeforeId = versions.at(-1)?.id
      if (nextBeforeId === undefined || (beforeId !== undefined && nextBeforeId >= beforeId)) {
        return true
      }
      beforeId = nextBeforeId
    }
  }
}
