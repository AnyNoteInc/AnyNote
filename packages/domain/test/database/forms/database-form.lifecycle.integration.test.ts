import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PageType, prisma } from '@repo/db'

import type { PlanFeatures } from '../../../src/billing/dto/billing.dto.ts'
import type { BillingService } from '../../../src/billing/services/billing.service.ts'
import {
  DatabaseFormRepository,
  type ArchiveFormRecord,
  type ManagedFormRecord,
  type PublishFormVersionRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import { DatabaseFormService } from '../../../src/database/forms/database-form.service.ts'
import {
  parseFormVersionDocument,
  type FormVersionDocument,
} from '../../../src/database/forms/public.ts'
import { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
import { DatabaseService } from '../../../src/database/services/database.service.ts'
import { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
import { PrismaUnitOfWork, type UnitOfWork } from '../../../src/shared/unit-of-work.ts'

const RUN = randomUUID().slice(0, 8)
const EMAIL = `database-form-lifecycle-${RUN}@example.test`
const NOW = new Date('2026-07-16T00:00:00.000Z')

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const features: PlanFeatures = {
  slug: 'pro',
  name: 'Pro',
  sortOrder: 2,
  isPaid: true,
  maxWorkspaces: null,
  maxMembersPerWorkspace: 100,
  chatsEnabled: true,
  pageIndexingEnabled: true,
  membersSettingsEnabled: true,
  aiSettingsEnabled: true,
  customMcpEnabled: true,
  customAiProvidersEnabled: true,
  prioritySupport: true,
  developerSpaceEnabled: true,
  publicSitesEnabled: true,
  formConditionalLogicEnabled: true,
  formCustomSlugEnabled: true,
  formBrandingRemovalEnabled: true,
  meetingsEnabled: true,
  pageHistoryDays: null,
}

const billing = {
  getWorkspaceFeatures: async () => features,
} as unknown as BillingService

const documentFor = (propertyId: string): FormVersionDocument => ({
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Concurrent form',
    submitButtonText: 'Send',
    hideAnyNoteBranding: false,
  },
  sections: [{ id: 'section-1', title: 'Questions', questionIds: ['question-1'] }],
  questions: [
    {
      id: 'question-1',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId, propertyType: 'TEXT' },
      label: 'Name',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
  ],
  transitions: [
    {
      id: 'transition-1',
      fromSectionId: 'section-1',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'ending-1' },
    },
  ],
  endings: [{ id: 'ending-1', title: 'Done' }],
})

let userId = ''
let workspaceId = ''
let pageId = ''
let sourceId = ''

async function createFixture(suffix: string) {
  const property = await prisma.databaseProperty.create({
    data: { sourceId, type: 'TEXT', name: `Name ${suffix}`, position: 1024 },
  })
  const view = await prisma.databaseView.create({
    data: { sourceId, type: 'FORM', title: `Form ${suffix}`, position: 2048 },
  })
  const form = await prisma.databaseForm.create({
    data: {
      sourceId,
      viewId: view.id,
      routeKey: `anf_lifecycle_${RUN}_${suffix}`,
      draftSchema: documentFor(property.id),
      createdById: userId,
    },
  })
  return { property, view, form }
}

function makeFormService(uow: UnitOfWork, formRepo = new DatabaseFormRepository(uow)) {
  return new DatabaseFormService(formRepo, new DatabaseRepository(uow), uow, billing, () => NOW)
}

class BlockingPublishRepository extends DatabaseFormRepository {
  constructor(
    uow: UnitOfWork,
    private readonly entered: Deferred,
    private readonly release: Deferred,
  ) {
    super(uow)
  }

  override async publishVersion(input: PublishFormVersionRecord): Promise<ManagedFormRecord> {
    const result = await super.publishVersion(input)
    this.entered.resolve()
    await this.release.promise
    return result
  }
}

class BlockingPropertyRepository extends DatabaseRepository {
  constructor(
    uow: UnitOfWork,
    private readonly entered: Deferred,
    private readonly release: Deferred,
  ) {
    super(uow)
  }

  override async updateProperty(
    id: string,
    data: Parameters<DatabaseRepository['updateProperty']>[1],
  ) {
    const result = await super.updateProperty(id, data)
    this.entered.resolve()
    await this.release.promise
    return result
  }
}

class FailingRenameRepository extends DatabaseRepository {
  override async updateProperty(
    id: string,
    data: Parameters<DatabaseRepository['updateProperty']>[1],
  ) {
    await super.updateProperty(id, data)
    throw new Error('TEST_RENAME_FAILURE')
  }
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      name: `Database Form Lifecycle ${RUN}`,
      firstName: 'Database',
      lastName: 'Form',
    },
  })
  userId = user.id
  const workspace = await prisma.workspace.create({
    data: { name: `Database Form Lifecycle ${RUN}`, createdById: user.id },
  })
  workspaceId = workspace.id
  await prisma.workspaceMember.create({
    data: { workspaceId, userId, role: 'OWNER' },
  })
  const page = await prisma.page.create({
    data: {
      workspaceId,
      type: PageType.DATABASE,
      title: 'Forms',
      createdById: userId,
    },
  })
  pageId = page.id
  const source = await prisma.databaseSource.create({
    data: { workspaceId, pageId, title: 'Forms' },
  })
  sourceId = source.id
})

afterAll(async () => {
  if (workspaceId) await prisma.workspace.deleteMany({ where: { id: workspaceId } })
  await prisma.user.deleteMany({ where: { email: EMAIL } })
})

describe('database form lifecycle real PostgreSQL concurrency', () => {
  it('archives to a view tombstone while a stale concurrent embed writer completes', async () => {
    const service = makeFormService(new PrismaUnitOfWork(prisma))
    const form = await service.create(userId, { pageId, title: 'Stale writer tombstone' })
    expect(form.viewId).not.toBeNull()
    const textPage = await prisma.page.create({
      data: {
        workspaceId,
        type: PageType.TEXT,
        title: 'Concurrent embed writer',
        createdById: userId,
      },
    })
    const entered = deferred()
    const release = deferred()
    const writerUow = new PrismaUnitOfWork(prisma)
    const writer = writerUow.transaction(async () => {
      await writerUow.client().page.update({
        where: { id: textPage.id },
        data: {
          content: {
            type: 'doc',
            content: [{ type: 'embeddedDatabase', attrs: { viewId: form.viewId } }],
          },
        },
      })
      entered.resolve()
      await release.promise
    })
    await entered.promise

    const archiving = service.archive(userId, { pageId, formId: form.id })
    try {
      const completedBeforeWriterCommit = await Promise.race([
        archiving.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ])
      expect(completedBeforeWriterCommit).toBe(true)
    } finally {
      release.resolve()
    }
    await writer
    await expect(archiving).resolves.toEqual({ ok: true })

    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ state: 'ARCHIVED', viewId: null })
    await expect(
      prisma.databaseView.findUniqueOrThrow({ where: { id: form.viewId! } }),
    ).resolves.toMatchObject({ archivedAt: expect.any(Date) })
    const committedPage = await prisma.page.findUniqueOrThrow({
      where: { id: textPage.id },
      select: { content: true },
    })
    expect(JSON.stringify(committedPage.content)).toContain(form.viewId!)
    await expect(
      new DatabaseRepository(new PrismaUnitOfWork(prisma)).listViews(sourceId),
    ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: form.viewId })]))
  })

  it('creates multiple independent forms and FORM views on one source with metadata-only audits', async () => {
    const uow = new PrismaUnitOfWork(prisma)
    const service = makeFormService(uow)
    const first = await service.create(userId, { pageId, title: 'First public form' })
    const second = await service.create(userId, { pageId, title: 'Second public form' })

    expect(first.id).not.toBe(second.id)
    expect(first.viewId).not.toBe(second.viewId)
    expect(first.routeKey).toMatch(/^anf_[A-Za-z0-9_-]{43}$/)
    expect(second.routeKey).toMatch(/^anf_[A-Za-z0-9_-]{43}$/)
    const audits = await prisma.workspaceAuditLog.findMany({
      where: {
        workspaceId,
        action: 'database_form.created',
      },
      orderBy: { createdAt: 'desc' },
      take: 2,
    })
    expect(audits).toHaveLength(2)
    for (const audit of audits) {
      expect(Object.keys((audit.metadata ?? {}) as object).sort()).toEqual(['formId', 'viewId'])
      expect(JSON.stringify(audit.metadata)).not.toContain('anf_')
    }
  })

  it('batch-resolves unique source workspace ids and omits missing sources', async () => {
    const repository = new DatabaseRepository(new PrismaUnitOfWork(prisma))

    await expect(
      repository.findSourceWorkspaceIds([sourceId, sourceId, randomUUID()]),
    ).resolves.toEqual(new Map([[sourceId, workspaceId]]))
  })

  it('creates a strict draft that can be duplicated and published immediately', async () => {
    const service = makeFormService(new PrismaUnitOfWork(prisma))
    const created = await service.create(userId, { pageId, title: 'Ready immediately' })

    expect(parseFormVersionDocument(created.draftSchema).questions).toMatchObject([
      { id: 'question-title', property: { kind: 'TITLE' }, required: true },
    ])
    await expect(
      service.duplicateByView(userId, { pageId, viewId: created.viewId! }),
    ).resolves.toMatchObject({ state: 'DRAFT', publishedVersionId: null })
    await expect(service.publish(userId, { pageId, formId: created.id })).resolves.toMatchObject({
      state: 'OPEN',
      versionNumber: 1,
    })
  })

  it('keeps published JSON append-only across republish and gives only v1 the exact 24h grace', async () => {
    const fixture = await createFixture('republish')
    const uow = new PrismaUnitOfWork(prisma)
    const service = makeFormService(uow)
    await service.publish(userId, { pageId, formId: fixture.form.id })
    const changed = documentFor(fixture.property.id)
    changed.questions[0] = { ...changed.questions[0]!, label: 'Changed draft label' }
    await service.updateDraft(userId, {
      pageId,
      formId: fixture.form.id,
      expectedRevision: 1,
      schema: changed,
    })
    await service.close(userId, { pageId, formId: fixture.form.id })
    await service.publish(userId, { pageId, formId: fixture.form.id })

    const versions = await prisma.databaseFormVersion.findMany({
      where: { formId: fixture.form.id },
      orderBy: { versionNumber: 'asc' },
    })
    expect(versions).toHaveLength(2)
    expect((versions[0]!.schema as FormVersionDocument).questions[0]!.label).toBe('Name')
    expect(versions[0]!.acceptUntil).toEqual(new Date('2026-07-17T00:00:00.000Z'))
    expect((versions[1]!.schema as FormVersionDocument).questions[0]!.label).toBe(
      'Changed draft label',
    )
    expect(versions[1]!.acceptUntil).toBeNull()
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: fixture.form.id } }),
    ).resolves.toMatchObject({ state: 'CLOSED', publishedVersionId: versions[1]!.id })
  })

  it('does not rename a property when the draft revision CAS conflicts', async () => {
    const fixture = await createFixture('rename-conflict')
    const document = documentFor(fixture.property.id)
    document.questions[0] = {
      ...document.questions[0]!,
      label: 'Renamed after CAS',
      syncWithPropertyName: true,
    }
    const service = makeFormService(new PrismaUnitOfWork(prisma))

    await expect(
      service.updateDraft(userId, {
        pageId,
        formId: fixture.form.id,
        expectedRevision: 99,
        schema: document,
        propertyNameIntents: { [fixture.property.id]: 'Renamed after CAS' },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_DRAFT_CONFLICT' })

    await expect(
      prisma.databaseProperty.findUniqueOrThrow({ where: { id: fixture.property.id } }),
    ).resolves.toMatchObject({ name: fixture.property.name })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: fixture.form.id } }),
    ).resolves.toMatchObject({ draftRevision: 1 })
  })

  it('rolls back both draft and property rename when the rename fails', async () => {
    const fixture = await createFixture('rename-rollback')
    const document = documentFor(fixture.property.id)
    document.questions[0] = {
      ...document.questions[0]!,
      label: 'Rolled back name',
      syncWithPropertyName: true,
    }
    const uow = new PrismaUnitOfWork(prisma)
    const service = new DatabaseFormService(
      new DatabaseFormRepository(uow),
      new FailingRenameRepository(uow),
      uow,
      billing,
      () => NOW,
    )

    await expect(
      service.updateDraft(userId, {
        pageId,
        formId: fixture.form.id,
        expectedRevision: 1,
        schema: document,
        propertyNameIntents: { [fixture.property.id]: 'Rolled back name' },
      }),
    ).rejects.toThrow('TEST_RENAME_FAILURE')

    await expect(
      prisma.databaseProperty.findUniqueOrThrow({ where: { id: fixture.property.id } }),
    ).resolves.toMatchObject({ name: fixture.property.name })
    const stored = await prisma.databaseForm.findUniqueOrThrow({ where: { id: fixture.form.id } })
    expect(stored.draftRevision).toBe(1)
    expect((stored.draftSchema as FormVersionDocument).questions[0]!.label).toBe('Name')
  })

  it('revalidates the current published schema before changing away from workspace audience', async () => {
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'PERSON', name: 'Owner', position: 1024 },
    })
    const view = await prisma.databaseView.create({
      data: { sourceId, type: 'FORM', title: 'Internal picker form', position: 2048 },
    })
    const internalDocument: FormVersionDocument = {
      ...documentFor(property.id),
      questions: [
        {
          ...documentFor(property.id).questions[0]!,
          property: { kind: 'PROPERTY', propertyId: property.id, propertyType: 'PERSON' },
          input: { kind: 'PERSON', maxSelections: 1 },
        },
      ],
    }
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        viewId: view.id,
        routeKey: `anf_lifecycle_${RUN}_audience-lock`,
        audience: 'WORKSPACE_MEMBERS_WITH_LINK',
        draftSchema: internalDocument,
        createdById: userId,
      },
    })
    const service = makeFormService(new PrismaUnitOfWork(prisma))
    await service.publish(userId, { pageId, formId: form.id })

    await expect(
      service.updateSettings(userId, {
        pageId,
        formId: form.id,
        audience: 'SIGNED_IN_WITH_LINK',
        respondentAccess: 'NONE',
        opensAt: null,
        closesAt: null,
        responseLimit: null,
        notifyOwners: true,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_AUDIENCE_INCOMPATIBLE' })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ audience: 'WORKSPACE_MEMBERS_WITH_LINK' })
  })

  it('revalidates every active grace schema before changing away from workspace audience', async () => {
    const internalProperty = await prisma.databaseProperty.create({
      data: { sourceId, type: 'PERSON', name: 'Previous owner', position: 1024 },
    })
    const publicProperty = await prisma.databaseProperty.create({
      data: { sourceId, type: 'TEXT', name: 'Current name', position: 2048 },
    })
    const view = await prisma.databaseView.create({
      data: { sourceId, type: 'FORM', title: 'Grace picker form', position: 3072 },
    })
    const internalDocument: FormVersionDocument = {
      ...documentFor(internalProperty.id),
      questions: [
        {
          ...documentFor(internalProperty.id).questions[0]!,
          property: {
            kind: 'PROPERTY',
            propertyId: internalProperty.id,
            propertyType: 'PERSON',
          },
          input: { kind: 'PERSON', maxSelections: 1 },
        },
      ],
    }
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        viewId: view.id,
        routeKey: `anf_lifecycle_${RUN}_grace-audience`,
        audience: 'WORKSPACE_MEMBERS_WITH_LINK',
        draftSchema: internalDocument,
        createdById: userId,
      },
    })
    const service = makeFormService(new PrismaUnitOfWork(prisma))
    await service.publish(userId, { pageId, formId: form.id })
    await service.updateDraft(userId, {
      pageId,
      formId: form.id,
      expectedRevision: 1,
      schema: documentFor(publicProperty.id),
    })
    await service.publish(userId, { pageId, formId: form.id })
    const newestDocument = documentFor(publicProperty.id)
    newestDocument.questions[0] = {
      ...newestDocument.questions[0]!,
      label: 'Current name v3',
    }
    await service.updateDraft(userId, {
      pageId,
      formId: form.id,
      expectedRevision: 2,
      schema: newestDocument,
    })
    await service.publish(userId, { pageId, formId: form.id })

    const versions = await prisma.databaseFormVersion.findMany({
      where: { formId: form.id },
      orderBy: { versionNumber: 'asc' },
    })
    expect(versions).toHaveLength(3)
    expect(versions[0]!.acceptUntil).toEqual(new Date('2026-07-17T00:00:00.000Z'))
    expect(versions[1]!.acceptUntil).toEqual(new Date('2026-07-17T00:00:00.000Z'))
    expect(versions[2]!.acceptUntil).toBeNull()

    await expect(
      service.updateSettings(userId, {
        pageId,
        formId: form.id,
        audience: 'ANYONE_WITH_LINK',
        respondentAccess: 'NONE',
        opensAt: null,
        closesAt: null,
        responseLimit: null,
        notifyOwners: true,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_AUDIENCE_INCOMPATIBLE' })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ audience: 'WORKSPACE_MEMBERS_WITH_LINK' })
  })

  it('publication first commits an immutable version, then blocks the queued destructive property mutation', async () => {
    const fixture = await createFixture('publish-first')
    const publishUow = new PrismaUnitOfWork(prisma)
    const propertyUow = new PrismaUnitOfWork(prisma)
    const entered = deferred()
    const release = deferred()
    const publishRepo = new BlockingPublishRepository(publishUow, entered, release)
    const publishService = makeFormService(publishUow, publishRepo)
    const propertyRepo = new DatabaseRepository(propertyUow)
    const propertyService = new DatabaseService(
      propertyRepo,
      new PageRepository(propertyUow),
      propertyUow,
      new DatabaseFormRepository(propertyUow),
      makeFormService(propertyUow),
    )

    const publishing = publishService.publish(userId, { pageId, formId: fixture.form.id })
    await entered.promise
    const mutating = propertyService.updateProperty(userId, {
      pageId,
      id: fixture.property.id,
      type: 'NUMBER',
    })
    release.resolve()

    await expect(publishing).resolves.toMatchObject({ state: 'OPEN', versionNumber: 1 })
    await expect(mutating).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'FORM_PROPERTY_IN_USE',
    })
    await expect(
      prisma.databaseProperty.findUniqueOrThrow({ where: { id: fixture.property.id } }),
    ).resolves.toMatchObject({ type: 'TEXT' })
    await expect(
      prisma.databaseFormVersion.count({ where: { formId: fixture.form.id } }),
    ).resolves.toBe(1)
  })

  it('property mutation first commits drift, then publication revalidates under the same source lock and creates no version', async () => {
    const fixture = await createFixture('property-first')
    const propertyUow = new PrismaUnitOfWork(prisma)
    const publishUow = new PrismaUnitOfWork(prisma)
    const entered = deferred()
    const release = deferred()
    const propertyRepo = new BlockingPropertyRepository(propertyUow, entered, release)
    const propertyService = new DatabaseService(
      propertyRepo,
      new PageRepository(propertyUow),
      propertyUow,
      new DatabaseFormRepository(propertyUow),
      makeFormService(propertyUow),
    )
    const publishService = makeFormService(publishUow)

    const mutating = propertyService.updateProperty(userId, {
      pageId,
      id: fixture.property.id,
      type: 'NUMBER',
    })
    await entered.promise
    const publishing = publishService.publish(userId, { pageId, formId: fixture.form.id })
    release.resolve()

    await expect(mutating).resolves.toMatchObject({ type: 'NUMBER' })
    await expect(publishing).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'FORM_PROPERTY_INVALID',
    })
    await expect(
      prisma.databaseFormVersion.count({ where: { formId: fixture.form.id } }),
    ).resolves.toBe(0)
  })

  it('rejects a stale reopen snapshot after archive instead of resurrecting the form', async () => {
    const fixture = await createFixture('archive-cas')
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: fixture.form.id,
        versionNumber: 1,
        schema: documentFor(fixture.property.id),
        schemaHash: 'a'.repeat(64),
        publishedById: userId,
        publishedAt: NOW,
      },
    })
    await prisma.databaseForm.update({
      where: { id: fixture.form.id },
      data: { state: 'CLOSED', publishedVersionId: version.id },
    })
    const uow = new PrismaUnitOfWork(prisma)
    const repo = new DatabaseFormRepository(uow)
    const stale = await repo.findManagedForm(pageId, fixture.form.id)
    expect(stale).not.toBeNull()

    await uow.transaction(() =>
      repo.archiveForm({ formId: fixture.form.id } satisfies ArchiveFormRecord),
    )
    await expect(
      uow.transaction(() =>
        repo.updateSettings({
          formId: fixture.form.id,
          expectedState: stale!.state,
          expectedUpdatedAt: stale!.updatedAt,
          expectedLinkRevision: stale!.linkRevision,
          expectedDraftRevision: stale!.draftRevision,
          expectedPublishedVersionId: stale!.publishedVersionId,
          state: 'OPEN',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_SETTINGS_CONFLICT' })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: fixture.form.id } }),
    ).resolves.toMatchObject({ state: 'ARCHIVED', viewId: null })
  })

  it('archives the form/view but preserves accepted row provenance and historical response count', async () => {
    const fixture = await createFixture('archive-preserves')
    const uow = new PrismaUnitOfWork(prisma)
    const service = makeFormService(uow)
    await service.publish(userId, { pageId, formId: fixture.form.id })
    const published = await prisma.databaseForm.findUniqueOrThrow({
      where: { id: fixture.form.id },
    })
    const itemPage = await prisma.page.create({
      data: { workspaceId, title: 'Accepted response', createdById: userId },
    })
    const row = await prisma.databaseRow.create({
      data: { sourceId, pageId: itemPage.id, position: 1024, createdById: userId },
    })
    const submission = await prisma.databaseFormSubmission.create({
      data: {
        formId: fixture.form.id,
        versionId: published.publishedVersionId!,
        rowId: row.id,
        respondentUserId: userId,
        endingId: 'ending-1',
        idempotencyKey: randomUUID(),
      },
    })
    await prisma.databaseForm.update({
      where: { id: fixture.form.id },
      data: { acceptedResponses: 1 },
    })

    await service.archive(userId, { pageId, formId: fixture.form.id })
    await expect(prisma.databaseRow.findUnique({ where: { id: row.id } })).resolves.not.toBeNull()
    await expect(
      prisma.databaseFormSubmission.findUnique({ where: { id: submission.id } }),
    ).resolves.not.toBeNull()
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: fixture.form.id } }),
    ).resolves.toMatchObject({ state: 'ARCHIVED', viewId: null, acceptedResponses: 1 })

    await prisma.databaseRow.delete({ where: { id: row.id } })
    await expect(
      prisma.databaseFormSubmission.findUnique({ where: { id: submission.id } }),
    ).resolves.toBeNull()
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: fixture.form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 1 })
  })
})
