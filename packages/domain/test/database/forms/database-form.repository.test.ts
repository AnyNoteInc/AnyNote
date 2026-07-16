import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Container } from 'inversify'

import {
  FORM_SCHEMA_VERSION,
  type FormVersionDocument,
} from '../../../src/database/forms/public.ts'
import {
  DatabaseFormRepository,
  type CreateFormRecord,
  type FormRepositoryContract,
  type PublishFormVersionRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { SHARED } from '../../../src/shared/tokens.ts'
import { databaseFormsModule } from '../../../src/database/forms/database-forms.module.ts'
import { DATABASE_FORMS } from '../../../src/database/forms/database-forms.tokens.ts'

const now = new Date('2026-07-16T00:00:00.000Z')

afterEach(() => vi.useRealTimers())

const documentFor = (propertyId: string): FormVersionDocument => ({
  schemaVersion: FORM_SCHEMA_VERSION,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Contact',
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

const choiceDocumentFor = (propertyId: string, optionIds: string[]): FormVersionDocument => ({
  ...documentFor(propertyId),
  questions: [
    {
      ...documentFor(propertyId).questions[0]!,
      property: { kind: 'PROPERTY', propertyId, propertyType: 'SELECT' },
      input: {
        kind: 'SINGLE_CHOICE',
        appearance: 'RADIO',
        options: optionIds.map((id) => ({ id, label: id })),
      },
    },
  ],
})

const managed = {
  id: 'form-1',
  sourceId: 'source-1',
  viewId: 'view-1',
  routeKey: 'anf_route',
  customSlug: null,
  linkRevision: 1,
  state: 'DRAFT',
  audience: 'ANYONE_WITH_LINK',
  respondentAccess: 'NONE',
  draftSchema: documentFor('property-1'),
  draftRevision: 1,
  publishedVersionId: null,
  opensAt: null,
  closesAt: null,
  responseLimit: null,
  acceptedResponses: 0,
  notifyOwners: true,
  createdById: 'user-1',
  createdAt: now,
  updatedAt: now,
  source: {
    id: 'source-1',
    workspaceId: 'workspace-1',
    pageId: 'page-1',
    structureLocked: false,
    page: { id: 'page-1', createdById: 'user-1', archivedAt: null, deletedAt: null },
    workspace: {
      id: 'workspace-1',
      securityPolicy: { disablePublicLinksSitesForms: false },
    },
    properties: [],
  },
  view: { id: 'view-1', title: 'Form', position: 0 },
  createdBy: { id: 'user-1', name: 'Owner', email: 'owner@example.test', image: null },
  publishedVersion: null,
}

function makeClient(overrides: Record<string, unknown> = {}) {
  const client = {
    databaseView: {
      create: vi.fn(async () => ({ id: 'view-1' })),
      delete: vi.fn(async () => ({ id: 'view-1' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    databaseForm: {
      create: vi.fn(async () => managed),
      findFirst: vi.fn(async () => managed),
      findMany: vi.fn(async () => [managed]),
      findUnique: vi.fn(async () => managed),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => managed),
    },
    databaseFormVersion: {
      create: vi.fn(async () => ({ id: 'version-2' })),
      update: vi.fn(async () => ({ id: 'version-1' })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
    databaseFormSubmission: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
    },
    ...overrides,
  }
  return client
}

function makeRepository(client = makeClient()) {
  const uow = {
    client: vi.fn(() => client),
    transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
  } as unknown as UnitOfWork
  return { client, uow, repository: new DatabaseFormRepository(uow) }
}

function makeSwitchableRepository() {
  const baseClient = makeClient()
  const transactionClient = makeClient()
  let activeClient = baseClient
  const uow = {
    client: vi.fn(() => activeClient),
    transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
  } as unknown as UnitOfWork
  const repository: FormRepositoryContract = new DatabaseFormRepository(uow)
  const activateTransactionClient = () => {
    activeClient = transactionClient
  }
  return { baseClient, transactionClient, uow, repository, activateTransactionClient }
}

function expectNoWriteCalls(client: ReturnType<typeof makeClient>) {
  expect(client.databaseView.create).not.toHaveBeenCalled()
  expect(client.databaseView.delete).not.toHaveBeenCalled()
  expect(client.databaseView.updateMany).not.toHaveBeenCalled()
  expect(client.databaseForm.create).not.toHaveBeenCalled()
  expect(client.databaseForm.updateMany).not.toHaveBeenCalled()
  expect(client.databaseForm.update).not.toHaveBeenCalled()
  expect(client.databaseFormVersion.create).not.toHaveBeenCalled()
  expect(client.databaseFormVersion.update).not.toHaveBeenCalled()
}

function expectNoRowsInSelection(args: unknown) {
  const serialized = JSON.stringify(args)
  expect(serialized).not.toContain('"rows"')
  expect(serialized).not.toContain('"content"')
  expect(serialized).not.toContain('"contentYjs"')
}

interface StoredVersionFixture {
  id?: string
  sourceId: string
  current: boolean
  acceptUntil: Date | null
  archived?: boolean
  schema: unknown
}

function mockActiveVersionQuery(
  client: ReturnType<typeof makeClient>,
  fixtures: StoredVersionFixture[],
) {
  client.databaseFormVersion.findMany.mockImplementationOnce(async (args) => {
    const propertyId = args.where?.form?.source?.properties?.some?.id
    const sourceId = propertyId === 'property-protected' ? 'source-protected' : null
    const graceClause = args.where?.OR?.find(
      (clause: { acceptUntil?: { gt?: Date } }) => clause.acceptUntil !== undefined,
    )
    const graceAfter = graceClause?.acceptUntil?.gt
    if (sourceId === null || graceAfter === undefined) return []
    const excludesArchived = args.where?.form?.state?.not === 'ARCHIVED'
    return fixtures
      .filter(
        (fixture) =>
          fixture.sourceId === sourceId &&
          (!excludesArchived || fixture.archived !== true) &&
          (fixture.current ||
            (fixture.acceptUntil !== null && fixture.acceptUntil.getTime() > graceAfter.getTime())),
      )
      .map(({ id, schema }, index) => ({ id: id ?? `version-${index}`, schema }))
  })
}

describe('DatabaseFormRepository writes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the FORM view and form through the active UnitOfWork client', async () => {
    const { client, uow, repository } = makeRepository()
    const input: CreateFormRecord = {
      sourceId: 'source-1',
      title: 'Contact form',
      position: 1024,
      routeKey: 'anf_route',
      draftSchema: documentFor('property-1'),
      createdById: 'user-1',
    }

    await expect(repository.createFormWithView(input)).resolves.toBe(managed)

    expect(uow.client).toHaveBeenCalled()
    expect(client.databaseView.create).toHaveBeenCalledWith({
      data: {
        sourceId: 'source-1',
        type: 'FORM',
        title: 'Contact form',
        position: 1024,
        settings: undefined,
      },
      select: { id: true },
    })
    expect(client.databaseForm.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceId: 'source-1', viewId: 'view-1' }),
      }),
    )
    expectNoRowsInSelection(client.databaseForm.create.mock.calls[0]?.[0])
  })

  it('conditionally updates a draft and re-reads it on the same active client', async () => {
    const { client, repository } = makeRepository()

    await expect(
      repository.updateDraftIfRevision({
        formId: 'form-1',
        expectedRevision: 3,
        draftSchema: documentFor('property-2'),
      }),
    ).resolves.toBe(managed)

    expect(client.databaseForm.updateMany).toHaveBeenCalledWith({
      where: { id: 'form-1', draftRevision: 3 },
      data: { draftSchema: documentFor('property-2'), draftRevision: { increment: 1 } },
    })
    expect(client.databaseForm.findUnique).toHaveBeenCalled()
    expectNoRowsInSelection(client.databaseForm.findUnique.mock.calls[0]?.[0])
  })

  it('returns null after an optimistic draft conflict without overwriting', async () => {
    const client = makeClient({
      databaseForm: {
        ...makeClient().databaseForm,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    })
    const { repository } = makeRepository(client)

    await expect(
      repository.updateDraftIfRevision({
        formId: 'form-1',
        expectedRevision: 3,
        draftSchema: documentFor('property-2'),
      }),
    ).resolves.toBeNull()
    expect(client.databaseForm.findUnique).not.toHaveBeenCalled()
  })

  it('publishes an immutable next version and only closes the prior current version', async () => {
    const { client, repository } = makeRepository()
    const input: PublishFormVersionRecord = {
      formId: 'form-1',
      previousPublishedVersionId: 'version-1',
      previousAcceptUntil: new Date('2026-07-16T00:05:00.000Z'),
      versionNumber: 2,
      schemaVersion: 1,
      schema: documentFor('property-1'),
      schemaHash: 'a'.repeat(64),
      publishedById: 'user-1',
      publishedAt: now,
      expectedState: 'DRAFT',
      expectedDraftRevision: 3,
      expectedUpdatedAt: now,
      expectedLinkRevision: 1,
      state: 'OPEN',
    }

    await expect(repository.publishVersion(input)).resolves.toBe(managed)

    expect(client.databaseForm.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'form-1',
        state: 'DRAFT',
        draftRevision: 3,
        updatedAt: now,
        linkRevision: 1,
        publishedVersionId: 'version-1',
      },
      data: { updatedAt: now },
    })
    expect(client.databaseFormVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1', formId: 'form-1' },
      data: { acceptUntil: input.previousAcceptUntil },
      select: { id: true },
    })
    expect(client.databaseFormVersion.create).toHaveBeenCalledWith({
      data: {
        formId: 'form-1',
        versionNumber: 2,
        schemaVersion: 1,
        schema: input.schema,
        schemaHash: input.schemaHash,
        publishedById: 'user-1',
        publishedAt: now,
      },
      select: { id: true },
    })
    expect(client.databaseForm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'form-1' },
        data: { publishedVersionId: 'version-2', state: 'OPEN' },
      }),
    )
    expect(client.databaseFormVersion.update.mock.calls[0]?.[0]).not.toHaveProperty('data.schema')
  })

  it.each([
    ['lifecycle', { state: 'ARCHIVED' }],
    ['draft', { draftRevision: 2 }],
    ['settings timestamp', { updatedAt: new Date('2026-07-16T00:00:01.000Z') }],
    ['link revision', { linkRevision: 2 }],
    ['published version', { publishedVersionId: 'version-newer' }],
  ])('rejects a concurrent %s mutation before writing any version', async (_kind, mutation) => {
    const storedSnapshot: Record<string, unknown> = {
      id: 'form-1',
      state: 'DRAFT',
      draftRevision: 1,
      updatedAt: now,
      linkRevision: 1,
      publishedVersionId: null,
      ...mutation,
    }
    const updateMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => ({
      count: Object.entries(storedSnapshot).every(([key, stored]) => {
        const expected = where[key]
        return stored instanceof Date && expected instanceof Date
          ? stored.getTime() === expected.getTime()
          : stored === expected
      })
        ? 1
        : 0,
    }))
    const client = makeClient({
      databaseForm: { ...makeClient().databaseForm, updateMany },
    })
    const { repository } = makeRepository(client)

    await expect(
      repository.publishVersion({
        formId: 'form-1',
        previousPublishedVersionId: null,
        previousAcceptUntil: null,
        versionNumber: 1,
        schemaVersion: 1,
        schema: documentFor('property-1'),
        schemaHash: 'c'.repeat(64),
        publishedById: 'user-1',
        publishedAt: now,
        expectedState: 'DRAFT',
        expectedDraftRevision: 1,
        expectedUpdatedAt: now,
        expectedLinkRevision: 1,
        state: 'OPEN',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_PUBLISH_CONFLICT' })

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'form-1',
        state: 'DRAFT',
        draftRevision: 1,
        updatedAt: now,
        linkRevision: 1,
        publishedVersionId: null,
      },
      data: { updatedAt: now },
    })
    expect(client.databaseFormVersion.update).not.toHaveBeenCalled()
    expect(client.databaseFormVersion.create).not.toHaveBeenCalled()
    expect(client.databaseForm.update).not.toHaveBeenCalled()
  })

  it('archives a form, clears its view link, then tombstones the old view on the active client', async () => {
    const { client, repository } = makeRepository()

    await repository.archiveForm({ formId: 'form-1' })

    expect(client.databaseForm.findUnique).toHaveBeenCalledWith({
      where: { id: 'form-1' },
      select: { viewId: true },
    })
    expect(client.databaseForm.update).toHaveBeenCalledWith({
      where: { id: 'form-1' },
      data: { state: 'ARCHIVED', viewId: null },
      select: { id: true },
    })
    expect(client.databaseView.delete).not.toHaveBeenCalled()
    expect(client.databaseView.updateMany).toHaveBeenCalledWith({
      where: { id: 'view-1', archivedAt: null },
      data: { archivedAt: expect.any(Date) },
    })
  })

  it('updates only supplied form settings through the active client', async () => {
    const { client, uow, repository } = makeRepository()

    await repository.updateSettings({
      formId: 'form-1',
      expectedState: 'DRAFT',
      expectedUpdatedAt: now,
      expectedLinkRevision: 1,
      expectedDraftRevision: 1,
      expectedPublishedVersionId: null,
      audience: 'SIGNED_IN_WITH_LINK',
      responseLimit: 25,
      notifyOwners: false,
    })

    expect(uow.client).toHaveBeenCalled()
    expect(client.databaseForm.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'form-1',
        state: 'DRAFT',
        updatedAt: now,
        linkRevision: 1,
        draftRevision: 1,
        publishedVersionId: null,
      },
      data: {
        audience: 'SIGNED_IN_WITH_LINK',
        responseLimit: 25,
        notifyOwners: false,
      },
    })
    expect(client.databaseForm.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'form-1' } }),
    )
    expect(client.databaseForm.update).not.toHaveBeenCalled()
  })

  it.each([
    ['reopen after archive', { state: 'ARCHIVED' }],
    ['settings update', { updatedAt: new Date('2026-07-16T00:00:01.000Z') }],
    ['link rotation', { linkRevision: 4 }],
    ['draft save', { draftRevision: 5 }],
    ['publication', { publishedVersionId: 'version-3' }],
  ])('rejects a stale %s before overwriting concurrent state', async (_kind, mutation) => {
    const storedSnapshot: Record<string, unknown> = {
      id: 'form-1',
      state: 'CLOSED',
      updatedAt: now,
      linkRevision: 3,
      draftRevision: 4,
      publishedVersionId: 'version-2',
      ...mutation,
    }
    const updateMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => ({
      count: Object.entries(storedSnapshot).every(([key, stored]) => {
        const expected = where[key]
        return stored instanceof Date && expected instanceof Date
          ? stored.getTime() === expected.getTime()
          : stored === expected
      })
        ? 1
        : 0,
    }))
    const client = makeClient({
      databaseForm: { ...makeClient().databaseForm, updateMany },
    })
    const { repository } = makeRepository(client)

    await expect(
      repository.updateSettings({
        formId: 'form-1',
        expectedState: 'CLOSED',
        expectedUpdatedAt: now,
        expectedLinkRevision: 3,
        expectedDraftRevision: 4,
        expectedPublishedVersionId: 'version-2',
        state: 'OPEN',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_SETTINGS_CONFLICT' })

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'form-1',
        state: 'CLOSED',
        updatedAt: now,
        linkRevision: 3,
        draftRevision: 4,
        publishedVersionId: 'version-2',
      },
      data: { state: 'OPEN' },
    })
    expect(client.databaseForm.findUnique).not.toHaveBeenCalled()
    expect(client.databaseForm.update).not.toHaveBeenCalled()
  })

  it('duplicates into a fresh DRAFT form without copying slug, versions or counters', async () => {
    const { client, uow, repository } = makeRepository()

    await repository.duplicateForm({
      sourceId: 'source-1',
      title: 'Contact form copy',
      position: 2048,
      routeKey: 'anf_fresh',
      draftSchema: documentFor('property-1'),
      createdById: 'user-2',
      audience: 'SIGNED_IN_WITH_LINK',
      respondentAccess: 'VIEW',
      opensAt: null,
      closesAt: null,
      responseLimit: 10,
      notifyOwners: false,
    })

    expect(uow.client).toHaveBeenCalled()
    const data = client.databaseForm.create.mock.calls[0]?.[0].data
    expect(data).toEqual({
      sourceId: 'source-1',
      viewId: 'view-1',
      routeKey: 'anf_fresh',
      draftSchema: documentFor('property-1'),
      createdById: 'user-2',
      audience: 'SIGNED_IN_WITH_LINK',
      respondentAccess: 'VIEW',
      opensAt: null,
      closesAt: null,
      responseLimit: 10,
      notifyOwners: false,
    })
    expect(data).not.toHaveProperty('state')
    expect(data).not.toHaveProperty('customSlug')
    expect(data).not.toHaveProperty('publishedVersionId')
    expect(data).not.toHaveProperty('acceptedResponses')
    expect(data).not.toHaveProperty('versions')
    expect(data).not.toHaveProperty('submissions')
    expect(data).not.toHaveProperty('uploads')
  })

  it('resolves the active transaction client separately for every write operation', async () => {
    const { baseClient, transactionClient, repository, activateTransactionClient } =
      makeSwitchableRepository()

    // Constructed while the base client is active; all work below starts only
    // after the UoW exposes its transaction client.
    activateTransactionClient()

    await repository.createFormWithView({
      sourceId: 'source-1',
      title: 'Form',
      position: 0,
      routeKey: 'anf_create',
      draftSchema: documentFor('property-1'),
      createdById: 'user-1',
    })
    await repository.updateDraftIfRevision({
      formId: 'form-1',
      expectedRevision: 1,
      draftSchema: documentFor('property-2'),
    })
    await repository.publishVersion({
      formId: 'form-1',
      previousPublishedVersionId: 'version-1',
      previousAcceptUntil: new Date('2026-07-16T00:05:00.000Z'),
      versionNumber: 2,
      schemaVersion: 1,
      schema: documentFor('property-2'),
      schemaHash: 'b'.repeat(64),
      publishedById: 'user-1',
      publishedAt: now,
      expectedState: 'DRAFT',
      expectedDraftRevision: 1,
      expectedUpdatedAt: now,
      expectedLinkRevision: 1,
      state: 'OPEN',
    })
    await repository.updateSettings({
      formId: 'form-1',
      expectedState: 'DRAFT',
      expectedUpdatedAt: now,
      expectedLinkRevision: 1,
      expectedDraftRevision: 1,
      expectedPublishedVersionId: null,
      notifyOwners: false,
    })
    await repository.duplicateForm({
      sourceId: 'source-1',
      title: 'Copy',
      position: 1024,
      routeKey: 'anf_copy',
      draftSchema: documentFor('property-2'),
      createdById: 'user-1',
      audience: 'ANYONE_WITH_LINK',
      respondentAccess: 'NONE',
      opensAt: null,
      closesAt: null,
      responseLimit: null,
      notifyOwners: true,
    })
    await repository.archiveForm({ formId: 'form-1' })
    await repository.listManagedForms('page-1')

    expectNoWriteCalls(baseClient)
    expect(baseClient.databaseForm.findUnique).not.toHaveBeenCalled()
    expect(baseClient.databaseForm.findMany).not.toHaveBeenCalled()
    expect(transactionClient.databaseView.create).toHaveBeenCalledTimes(2)
    expect(transactionClient.databaseView.delete).not.toHaveBeenCalled()
    expect(transactionClient.databaseView.updateMany).toHaveBeenCalledTimes(1)
    expect(transactionClient.databaseForm.create).toHaveBeenCalledTimes(2)
    expect(transactionClient.databaseForm.updateMany).toHaveBeenCalledTimes(3)
    expect(transactionClient.databaseForm.update).toHaveBeenCalledTimes(2)
    expect(transactionClient.databaseFormVersion.update).toHaveBeenCalledTimes(1)
    expect(transactionClient.databaseFormVersion.create).toHaveBeenCalledTimes(1)
    expect(transactionClient.databaseForm.findUnique).toHaveBeenCalledTimes(3)
    expect(transactionClient.databaseForm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: { pageId: 'page-1' } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    )
    expectNoRowsInSelection(transactionClient.databaseForm.findMany.mock.calls[0]?.[0])
  })
})

describe('database forms dependency injection', () => {
  it('keeps the UnitOfWork-backed repository binding when the lifecycle service token is added', async () => {
    expect(Object.keys(DATABASE_FORMS)).toEqual(['Repository', 'Service', 'AccessResolver'])
    const { uow } = makeRepository()
    const container = new Container()
    container.bind(SHARED.UnitOfWork).toConstantValue(uow)
    await container.load(databaseFormsModule)

    expect(container.get(DATABASE_FORMS.Repository)).toBeInstanceOf(DatabaseFormRepository)
  })
})

describe('database form repository input types', () => {
  it('excludes archived publication snapshots and non-public target states', () => {
    expectTypeOf<PublishFormVersionRecord['expectedState']>().toEqualTypeOf<
      'DRAFT' | 'OPEN' | 'CLOSED'
    >()
    expectTypeOf<PublishFormVersionRecord['state']>().toEqualTypeOf<'OPEN' | 'CLOSED'>()
  })
})

describe('DatabaseFormRepository focused reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  it('scopes managed form lookup by page and form without selecting database rows', async () => {
    const { client, repository } = makeRepository()

    await repository.findManagedForm('page-1', 'form-1')

    expect(client.databaseForm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'form-1', source: { pageId: 'page-1' } },
      }),
    )
    expectNoRowsInSelection(client.databaseForm.findFirst.mock.calls[0]?.[0])
  })

  it('uses one normalized locator OR without preloading an arbitrary grace version', async () => {
    const { client, repository } = makeRepository()

    await repository.findByLocator('my-custom-slug')

    expect(client.databaseForm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ routeKey: 'my-custom-slug' }, { customSlug: 'my-custom-slug' }],
        },
      }),
    )
    const args = client.databaseForm.findFirst.mock.calls[0]?.[0]
    expectNoRowsInSelection(args)
    expect(args).toEqual(
      expect.objectContaining({
        select: expect.objectContaining({
          publishedVersion: expect.any(Object),
          source: expect.objectContaining({
            select: expect.objectContaining({
              workspace: {
                select: {
                  id: true,
                  securityPolicy: { select: { disablePublicLinksSitesForms: true } },
                },
              },
            }),
          }),
        }),
      }),
    )
    expect(args?.select).not.toHaveProperty('versions')
  })

  it('paginates responses by submittedAt and id without selecting page bodies', async () => {
    const submission = (id: string, submittedAt: Date) => ({
      id,
      formId: 'form-1',
      versionId: 'version-1',
      rowId: `row-${id}`,
      respondentUserId: null,
      endingId: 'ending-1',
      idempotencyKey: `00000000-0000-7000-8000-00000000000${id}`,
      submittedAt,
      row: {
        id: `row-${id}`,
        pageId: `page-${id}`,
        position: Number(id),
        createdAt: submittedAt,
        createdById: null,
        updatedAt: submittedAt,
        updatedById: null,
        page: { title: id, icon: null },
        cells: [],
      },
    })
    const records = [
      submission('1', new Date('2026-07-15T03:00:00.000Z')),
      submission('2', new Date('2026-07-15T02:00:00.000Z')),
      submission('3', new Date('2026-07-15T01:00:00.000Z')),
    ]
    const client = makeClient({
      databaseFormSubmission: {
        ...makeClient().databaseFormSubmission,
        findMany: vi.fn(async () => records),
      },
    })
    const { repository } = makeRepository(client)
    const cursor = { submittedAt: new Date('2026-07-16T00:00:00.000Z'), id: 'cursor-id' }
    const rowWhere = { OR: [{ createdById: 'reader' }] }

    const result = await repository.listResponses({
      formId: 'form-1', cursor, limit: 2, rowWhere,
    })

    expect(client.databaseFormSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          formId: 'form-1',
          OR: [
            { submittedAt: { lt: cursor.submittedAt } },
            { submittedAt: cursor.submittedAt, id: { lt: 'cursor-id' } },
          ],
          row: { is: { deletedAt: null, AND: [rowWhere] } },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    )
    expect(result.items).toEqual(records.slice(0, 2))
    expect(result.nextCursor).toEqual({ submittedAt: records[1]!.submittedAt, id: '2' })
    const args = client.databaseFormSubmission.findMany.mock.calls[0]?.[0]
    expectNoRowsInSelection(args)
    expect(args.select).not.toHaveProperty('formId')
    expect(args.select).not.toHaveProperty('versionId')
    expect(args.select).not.toHaveProperty('rowId')
    expect(args.select).not.toHaveProperty('idempotencyKey')
    expect(args.select.row.select).toEqual({
      id: true,
      pageId: true,
      position: true,
      createdAt: true,
      createdById: true,
      updatedAt: true,
      updatedById: true,
      page: { select: { title: true, icon: true } },
      cells: { select: { propertyId: true, value: true } },
    })
  })

  it('orders form versions newest-first with a stable id tie-breaker', async () => {
    const { client, repository } = makeRepository()

    await repository.listVersions('form-1')

    expect(client.databaseFormVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { formId: 'form-1' },
        orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      }),
    )
  })

  it('loads a bounded keyset page of currently accepted versions without expired history', async () => {
    const { client, repository } = makeRepository()
    const acceptedAt = new Date('2026-07-16T00:00:00.000Z')

    await repository.listVersions('form-1', {
      acceptedAt,
      beforeVersionNumber: 42,
      limit: 25,
    })

    expect(client.databaseFormVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          formId: 'form-1',
          OR: [{ currentForForm: { isNot: null } }, { acceptUntil: { gt: acceptedAt } }],
          versionNumber: { lt: 42 },
        },
        orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
        take: 25,
      }),
    )
  })

  it('uses focused unique lookups for version and submission provenance', async () => {
    const { client, repository } = makeRepository()

    await repository.findVersion('form-1', 3)
    await repository.findSubmission('submission-1')
    await repository.findSubmissionByIdempotency('form-1', '00000000-0000-7000-8000-000000000001')

    expect(client.databaseFormVersion.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { formId_versionNumber: { formId: 'form-1', versionNumber: 3 } },
        select: expect.objectContaining({ schema: true, acceptUntil: true }),
      }),
    )
    expect(client.databaseFormSubmission.findUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'submission-1' } }),
    )
    expect(client.databaseFormSubmission.findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          formId_idempotencyKey: {
            formId: 'form-1',
            idempotencyKey: '00000000-0000-7000-8000-000000000001',
          },
        },
      }),
    )
    for (const [args] of client.databaseFormSubmission.findUnique.mock.calls) {
      expectNoRowsInSelection(args)
    }
  })
})

describe('DatabaseFormRepository protected property dependencies', () => {
  it('detects a reference in a current published version', async () => {
    const client = makeClient()
    mockActiveVersionQuery(client, [
      {
        sourceId: 'source-protected',
        current: true,
        acceptUntil: null,
        schema: documentFor('property-protected'),
      },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
    expect(client.databaseFormVersion.findMany).toHaveBeenCalledWith({
      where: {
        form: {
          state: { not: 'ARCHIVED' },
          source: { properties: { some: { id: 'property-protected' } } },
        },
        OR: [{ currentForForm: { isNot: null } }, { acceptUntil: { gt: now } }],
      },
      orderBy: [{ id: 'desc' }],
      take: 100,
      select: { id: true, schema: true },
    })
  })

  it('protects only removed option IDs referenced by a current or grace document', async () => {
    const client = makeClient()
    mockActiveVersionQuery(client, [
      {
        sourceId: 'source-protected',
        current: true,
        acceptUntil: null,
        schema: choiceDocumentFor('property-protected', ['option-used', 'option-kept']),
      },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency(
        'property-protected',
        now,
        ['option-unused'],
      ),
    ).resolves.toBe(false)

    mockActiveVersionQuery(client, [
      {
        sourceId: 'source-protected',
        current: false,
        acceptUntil: new Date('2026-07-16T00:00:01.000Z'),
        schema: choiceDocumentFor('property-protected', ['option-used', 'option-kept']),
      },
    ])
    await expect(
      repository.hasProtectedPropertyDependency(
        'property-protected',
        now,
        ['option-used'],
      ),
    ).resolves.toBe(true)
  })

  it('detects a reference in a grace-period version', async () => {
    const client = makeClient()
    mockActiveVersionQuery(client, [
      {
        sourceId: 'source-protected',
        current: false,
        acceptUntil: new Date('2026-07-16T00:00:01.000Z'),
        schema: documentFor('property-protected'),
      },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
    expect(client.databaseFormVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ acceptUntil: { gt: now } }]),
        }),
      }),
    )
  })

  it('does not protect a dependency that exists only in an expired version', async () => {
    const client = makeClient()
    mockActiveVersionQuery(client, [
      {
        sourceId: 'source-protected',
        current: false,
        acceptUntil: new Date('2026-07-15T23:59:59.000Z'),
        schema: documentFor('property-protected'),
      },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(false)
    expect(client.databaseFormVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ acceptUntil: { gt: now } }]),
        }),
      }),
    )
  })

  it('ignores a malformed active schema from an unrelated source', async () => {
    const client = makeClient()
    mockActiveVersionQuery(client, [
      {
        sourceId: 'source-unrelated',
        current: true,
        acceptUntil: null,
        schema: { malformed: 'unrelated-source' },
      },
      {
        sourceId: 'source-protected',
        current: true,
        acceptUntil: null,
        schema: documentFor('other-property'),
      },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(false)
  })

  it('fails closed when an active stored schema in the relevant source is malformed', async () => {
    const client = makeClient()
    mockActiveVersionQuery(client, [
      {
        sourceId: 'source-protected',
        current: true,
        acceptUntil: null,
        schema: { malformed: true },
      },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
    expect(client.databaseFormVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          form: {
            state: { not: 'ARCHIVED' },
            source: { properties: { some: { id: 'property-protected' } } },
          },
        }),
      }),
    )
  })

  it('detects a protected dependency in a later active-version batch', async () => {
    const client = makeClient()
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `version-${(200 - index).toString().padStart(3, '0')}`,
      schema: documentFor('other-property'),
    }))
    client.databaseFormVersion.findMany
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([{ id: 'version-100', schema: documentFor('property-protected') }])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
    expect(client.databaseFormVersion.findMany).toHaveBeenCalledTimes(2)
    expect(client.databaseFormVersion.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: { lt: 'version-101' } }),
        orderBy: [{ id: 'desc' }],
        take: 100,
        select: { id: true, schema: true },
      }),
    )
  })

  it('fails closed for a malformed active schema in a later batch', async () => {
    const client = makeClient()
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `version-${(200 - index).toString().padStart(3, '0')}`,
      schema: documentFor('other-property'),
    }))
    client.databaseFormVersion.findMany
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([{ id: 'version-100', schema: { malformed: true } }])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
    expect(client.databaseFormVersion.findMany).toHaveBeenCalledTimes(2)
  })

  it('fails closed without looping when an active-version batch does not advance', async () => {
    const client = makeClient()
    const repeatedBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `version-${(200 - index).toString().padStart(3, '0')}`,
      schema: documentFor('other-property'),
    }))
    client.databaseFormVersion.findMany.mockResolvedValue(repeatedBatch)
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
    expect(client.databaseFormVersion.findMany).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['current', true, null],
    ['grace', false, new Date('2026-07-16T00:00:01.000Z')],
  ] as const)(
    'ignores %s dependencies after the form is archived',
    async (_kind, current, acceptUntil) => {
      const client = makeClient()
      mockActiveVersionQuery(client, [
        {
          sourceId: 'source-protected',
          current,
          acceptUntil,
          archived: true,
          schema: documentFor('property-protected'),
        },
      ])
      const { repository } = makeRepository(client)

      await expect(
        repository.hasProtectedPropertyDependency('property-protected', now),
      ).resolves.toBe(false)
    },
  )
})
